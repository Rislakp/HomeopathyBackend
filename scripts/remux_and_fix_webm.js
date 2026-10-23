/**
 * Media Remuxing & Indexing Utility for WhiteCoat Academy
 *
 * Converts unindexed Chrome MediaRecorder WebM recordings to FastStart MP4.
 * - Transcodes video to H.264/AVC and audio to AAC.
 * - Moves 'moov' atom to file start (-movflags +faststart) for instant random seeking.
 * - Preserves original recording untouched on S3.
 * - Verifies output with ffprobe before updating database records.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const dotenv = require('dotenv');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mongoose = require('mongoose');

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});
const bucket = process.env.AWS_S3_BUCKET || 'whitecoat-media-prod';

function hasFastStartMoov(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    let offset = 0;
    let foundMoovBeforeMdat = false;
    while (offset + 8 <= fileSize) {
      const header = Buffer.alloc(16);
      const read = fs.readSync(fd, header, 0, 8, offset);
      if (read < 8) break;
      let atomSize = header.readUInt32BE(0);
      const atomType = header.toString('ascii', 4, 8);
      let headerSize = 8;
      if (atomSize === 1) {
        if (offset + 16 > fileSize || fs.readSync(fd, header, 8, 8, offset + 8) < 8) break;
        const largeSize = header.readBigUInt64BE(8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
        atomSize = Number(largeSize);
        headerSize = 16;
      } else if (atomSize === 0) {
        atomSize = fileSize - offset;
      }
      if (atomSize < headerSize || offset + atomSize > fileSize) break;
      if (atomType === 'moov') {
        foundMoovBeforeMdat = true;
        break;
      }
      if (atomType === 'mdat') break;
      offset += atomSize;
    }
    return foundMoovBeforeMdat;
  } finally {
    fs.closeSync(fd);
  }
}

async function remuxAndVerify(s3Key, options = {}) {
  console.log('[MediaRemuxer] Starting process for:', s3Key);
  const startTime = Date.now();
  const workDir = path.join(__dirname, '../scratch');
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const inputName = path.basename(s3Key);
  const baseName = path.basename(inputName, path.extname(inputName));
  const outputName = `${baseName}_faststart.mp4`;
  const localOutput = path.join(workDir, outputName);

  // 1. Generate presigned URL for download
  const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  }), { expiresIn: 7200 });

  console.log('[MediaRemuxer] Downloading and remuxing original recording from S3...');
  const ffmpegCmd = options.ffmpegPath || 'ffmpeg';
  const ffmpegArgs = [
    '-y',
    '-i', downloadUrl,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', options.preset || 'medium',
    '-crf', String(options.crf ?? 23),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    localOutput
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegCmd, ffmpegArgs, { stdio: 'inherit' });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed with exit code: ${code}`));
    });
    proc.on('error', reject);
  });

  // 2. Validate output with ffprobe
  console.log('[MediaRemuxer] Validating output with ffprobe...');
  const ffprobeCmd = options.ffprobePath || 'ffprobe';
  const probeData = await new Promise((resolve, reject) => {
    execFile(ffprobeCmd, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      localOutput
    ], (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });

  const duration = parseFloat(probeData.format?.duration || '0');
  if (duration <= 0 || isNaN(duration)) {
    throw new Error('Verification failed: output video has invalid or missing duration.');
  }

  const videoStream = probeData.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = probeData.streams.find((stream) => stream.codec_type === 'audio');
  if (!videoStream || videoStream.codec_name !== 'h264') {
    throw new Error(`Verification failed: expected H.264 video, got ${videoStream?.codec_name || 'no video stream'}.`);
  }
  if (audioStream && audioStream.codec_name !== 'aac') {
    throw new Error(`Verification failed: expected AAC audio, got ${audioStream.codec_name}.`);
  }
  if (!hasFastStartMoov(localOutput)) {
    throw new Error('Verification failed: MP4 moov atom is missing or follows the media data.');
  }

  const stat = fs.statSync(localOutput);
  console.log('[MediaRemuxer] Output validated successfully!', {
    sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
    durationFormatted: `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s`,
    streams: probeData.streams.map(s => (`${s.codec_type}:${s.codec_name}`)).join(', '),
    fastStart: true,
  });

  // 3. Upload indexed copy to S3
  const targetKey = `videos/${Date.now()}-${outputName}`;
  console.log('[MediaRemuxer] Uploading indexed copy to S3 as:', targetKey);
  const fileStream = fs.createReadStream(localOutput);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    Body: fileStream,
    ContentType: 'video/mp4',
    CacheControl: 'private, max-age=31536000'
  }));

  console.log('[MediaRemuxer] Completed successfully in', Math.round((Date.now() - startTime) / 1000), 'seconds.');
  return {
    success: true,
    originalKey: s3Key,
    processedKey: targetKey,
    duration,
    sizeBytes: stat.size,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name || null,
    fastStart: true
  };
}

module.exports = { remuxAndVerify, hasFastStartMoov };
