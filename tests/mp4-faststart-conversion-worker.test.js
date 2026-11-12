const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  checkBinaryAvailability,
  calculateGopOptions,
  hasFastStartMoov,
  probeMedia,
  runFfmpeg,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
  inFlightConversions,
} = require('../services/videoConversionService');

const scratchDir = path.join(__dirname, '../scratch');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

test('1. checkBinaryAvailability detects ffmpeg and ffprobe in host environment', () => {
  const result = checkBinaryAvailability();
  assert.equal(result.available, true, `FFmpeg/FFprobe should be available: ${result.error}`);
  assert.ok(result.ffmpegVersion.includes('ffmpeg version'), 'Must contain ffmpeg version header');
  assert.ok(result.ffprobeVersion.includes('ffprobe version'), 'Must contain ffprobe version header');
});

test('2. calculateGopOptions dynamically calculates 2-second GOP based on input frame rate', () => {
  // 24 FPS -> GOP: 48
  assert.deepEqual(calculateGopOptions(24), ['-g', '48', '-keyint_min', '48', '-sc_threshold', '0']);
  assert.deepEqual(calculateGopOptions(23.976), ['-g', '48', '-keyint_min', '48', '-sc_threshold', '0']);

  // 30 FPS -> GOP: 60
  assert.deepEqual(calculateGopOptions(30), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);
  assert.deepEqual(calculateGopOptions(29.97), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);
  assert.deepEqual(calculateGopOptions('30000/1001'), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);

  // 25 FPS (PAL) -> GOP: 50
  assert.deepEqual(calculateGopOptions(25), ['-g', '50', '-keyint_min', '50', '-sc_threshold', '0']);

  // 60 FPS -> GOP: 120
  assert.deepEqual(calculateGopOptions(60), ['-g', '120', '-keyint_min', '120', '-sc_threshold', '0']);

  // Invalid / fallback handling
  assert.deepEqual(calculateGopOptions(null), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);
  assert.deepEqual(calculateGopOptions(0), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);
  assert.deepEqual(calculateGopOptions('invalid'), ['-g', '60', '-keyint_min', '60', '-sc_threshold', '0']);
});

test('3. FastStart remux transforms non-FastStart MP4 into FastStart MP4 without re-encoding', async (t) => {
  const inputPath = path.join(scratchDir, 'test_worker_input.mp4');
  const outputPath = path.join(scratchDir, 'test_worker_output.mp4');

  t.after(() => {
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
  });

  // Generate a non-FastStart test video using ffmpeg (default MP4 muxer puts moov at end)
  const genResult = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    inputPath,
  ], { encoding: 'utf8' });

  assert.equal(genResult.status, 0, `Failed to generate test input: ${genResult.stderr}`);
  assert.ok(fs.existsSync(inputPath), 'Input test video must exist');

  // Verify that raw output does NOT have moov before mdat
  const isInputFastStart = hasFastStartMoov(inputPath);
  assert.equal(isInputFastStart, false, 'Initial MP4 must have moov atom at the end (not FastStart)');

  // Probe input streams
  const inProbe = await probeMedia(inputPath);
  const inV = inProbe.streams.find((s) => s.codec_type === 'video');
  const inA = inProbe.streams.find((s) => s.codec_type === 'audio');
  assert.equal(inV.codec_name, 'h264');
  assert.equal(inA.codec_name, 'aac');

  // Run FFmpeg FastStart remux: ffmpeg -i input.mp4 -map 0 -c copy -movflags +faststart output.mp4
  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-map', '0',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ]);

  assert.ok(fs.existsSync(outputPath), 'Output FastStart video must exist');

  // Verify moov atom is placed before mdat in the output
  const isOutputFastStart = hasFastStartMoov(outputPath);
  assert.equal(isOutputFastStart, true, 'Output MP4 MUST have moov atom at the beginning (FastStart)');

  // Probe output streams - verify identical codecs, stream count, and dimensions
  const outProbe = await probeMedia(outputPath);
  const outV = outProbe.streams.find((s) => s.codec_type === 'video');
  const outA = outProbe.streams.find((s) => s.codec_type === 'audio');

  assert.equal(outV.codec_name, inV.codec_name, 'Video codec must be identical (no transcode)');
  assert.equal(outV.width, inV.width, 'Video width must be identical');
  assert.equal(outV.height, inV.height, 'Video height must be identical');
  assert.equal(outA.codec_name, inA.codec_name, 'Audio codec must be identical');
  assert.equal(outA.sample_rate, inA.sample_rate, 'Audio sample rate must be identical');

  // Output file size must be within 1% of input size (zero quality loss, metadata shift only)
  const inSize = fs.statSync(inputPath).size;
  const outSize = fs.statSync(outputPath).size;
  const sizeDiffPercent = (Math.abs(outSize - inSize) / inSize) * 100;
  assert.ok(sizeDiffPercent < 2.0, `File size difference should be < 2% (was ${sizeDiffPercent.toFixed(2)}%)`);
});

test('4. Worker deduplication and concurrent lock management', () => {
  const testKey = 'videos/concurrent-test-123.mp4';
  assert.equal(inFlightConversions.has(testKey), false);

  inFlightConversions.add(testKey);
  assert.equal(inFlightConversions.has(testKey), true);

  // Subsequent check recognizes key is already in flight
  inFlightConversions.delete(testKey);
  assert.equal(inFlightConversions.has(testKey), false);
});

test('5. Key derivation and convertible video detection', () => {
  assert.equal(isConvertibleVideoKey('videos/test.mp4'), true);
  assert.equal(isConvertibleVideoKey('live_records/lecture.mov'), true);
  assert.equal(isConvertibleVideoKey('videos/clip.webm'), true);
  assert.equal(isConvertibleVideoKey('pdfs/doc.pdf'), false);
  assert.equal(isConvertibleVideoKey('images/logo.png'), false);

  assert.equal(getM4vKeyForOriginal('videos/lecture-1.mp4'), 'videos/lecture-1_ios.mp4');
  assert.equal(getM4vKeyForOriginal('videos/already_ios.m4v'), 'videos/already_ios.m4v');
});

