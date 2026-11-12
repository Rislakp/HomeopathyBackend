const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const {
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket } = require('../config/s3');
const VideoConversion = require('../models/VideoConversion');
const Course = require('../models/Course');
const Recording = require('../models/Recording');

/**
 * Checks whether FFmpeg and FFprobe binaries are available and executable.
 * Supports custom paths via FFMPEG_PATH and FFPROBE_PATH environment variables.
 */
function checkBinaryAvailability() {
  const ffmpegCmd = (process.env.FFMPEG_PATH || 'ffmpeg').trim();
  const ffprobeCmd = (process.env.FFPROBE_PATH || 'ffprobe').trim();
  let ffmpegVer = null;
  let ffprobeVer = null;
  let err = null;

  try {
    const out = execFileSync(ffmpegCmd, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    ffmpegVer = out.split('\n')[0].trim();
  } catch (e) {
    err = `FFmpeg binary '${ffmpegCmd}' is not executable: ${e.message}`;
  }

  try {
    const out = execFileSync(ffprobeCmd, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    ffprobeVer = out.split('\n')[0].trim();
  } catch (e) {
    const ffprobeErr = `FFprobe binary '${ffprobeCmd}' is not executable: ${e.message}`;
    err = err ? `${err}; ${ffprobeErr}` : ffprobeErr;
  }

  return {
    available: !err,
    ffmpegVersion: ffmpegVer,
    ffprobeVersion: ffprobeVer,
    ffmpegPath: ffmpegCmd,
    ffprobePath: ffprobeCmd,
    error: err || null,
  };
}

/**
 * Calculates FFmpeg GOP parameters dynamically targeting approximately a 2-second keyframe interval.
 * Note: These options apply ONLY when encoding video; do NOT apply to '-c copy' remuxing.
 *
 * @param {number|string} fps - Input/target frame rate (e.g. 24, 29.97, 30, '30000/1001')
 * @returns {string[]} Array of FFmpeg CLI arguments
 */
function parseFps(fps) {
  let numFps = 30;
  if (typeof fps === 'number' && Number.isFinite(fps) && fps > 0) {
    numFps = fps;
  } else if (typeof fps === 'string') {
    if (fps.includes('/')) {
      const [num, den] = fps.split('/').map(Number);
      if (den && Number.isFinite(num / den) && num / den > 0) {
        numFps = num / den;
      }
    } else {
      const parsed = parseFloat(fps);
      if (Number.isFinite(parsed) && parsed > 0) {
        numFps = parsed;
      }
    }
  }

  return numFps;
}

function calculateGopOptions(fps) {
  const validFps = Math.min(Math.max(parseFps(fps), 1), 120);
  const gopSize = Math.max(12, Math.round(validFps * 2.0));

  return [
    '-g', String(gopSize),
    '-keyint_min', String(gopSize),
    '-sc_threshold', '0',
  ];
}

// Bump this when the iOS encode settings change, so older renditions get rebuilt.
const IOS_ENCODE_PROFILE = 'ios-seek-v2';

/**
 * Builds the FFmpeg args for the iOS rendition.
 *
 * iOS Safari freezes on seek when a video has long keyframe gaps or a variable
 * frame rate (common in screen recordings). A plain '-c copy' remux keeps those
 * problems, so we always re-encode to: constant frame rate (max 30), closed GOP
 * with a keyframe every 2 seconds, H.264 Main 4.0, max 1920px wide, AAC 48 kHz,
 * and faststart.
 */
function buildIosEncodeArgs(inputPath, outputPath, fps, options = {}) {
  const sourceFps = parseFps(fps);
  const targetFps = Math.min(Math.max(Math.round(sourceFps), 1), 30);
  return [
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', "scale='min(1920,iw)':-2",
    '-c:v', 'libx264',
    '-preset', options.preset || 'medium',
    '-crf', String(options.crf || 22),
    '-profile:v', 'main',
    '-level:v', '4.0',
    '-pix_fmt', 'yuv420p',
    '-r', String(targetFps),
    ...calculateGopOptions(targetFps),
    '-flags', '+cgop',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-af', 'aresample=async=1',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ];
}

/**
 * Validates whether binary file has 'moov' atom before 'mdat' atom (FastStart).
 */
function hasFastStartMoov(filePath) {
  if (!fs.existsSync(filePath)) return false;
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

/**
 * Runs ffprobe to extract format and stream metadata as JSON with timeout protection.
 */
async function probeMedia(target, ffprobeCmd = null, timeoutMs = 30000) {
  const cmd = ffprobeCmd || process.env.FFPROBE_PATH || 'ffprobe';
  return new Promise((resolve, reject) => {
    let timer = null;
    const proc = execFile(
      cmd,
      [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-print_format', 'json',
        target,
      ],
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (timer) clearTimeout(timer);
        if (err) return reject(new Error(`ffprobe failed: ${err.message}. ${stderr || ''}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe JSON output: ${e.message}`));
        }
      }
    );

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`ffprobe timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }
  });
}

/**
 * Runs FFmpeg with timeout handling, exit-code validation, and structured error reporting.
 */
function runFfmpeg(args, { timeoutMs = 1800000, ffmpegCmd = null } = {}) {
  const cmd = ffmpegCmd || process.env.FFMPEG_PATH || 'ffmpeg';
  return new Promise((resolve, reject) => {
    console.info(`[VideoConversion] Spawning FFmpeg: ${cmd} ${args.slice(0, 10).join(' ')}...`);
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const lastErr = stderr.trim().split('\n').slice(-5).join('; ');
        reject(new Error(`FFmpeg exited with error code ${code}: ${lastErr}`));
      }
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Downloads an S3 object to a local file using stream piping with size verification.
 */
async function downloadS3Object(s3Key, destinationPath) {
  console.info(`[VideoConversion] Downloading S3 object ${s3Key} to ${destinationPath}...`);
  const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
  const expectedSize = head.ContentLength;

  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  const writeStream = fs.createWriteStream(destinationPath);

  await new Promise((resolve, reject) => {
    const stream = res.Body;
    stream.pipe(writeStream);
    stream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });

  const stat = fs.statSync(destinationPath);
  if (expectedSize !== undefined && expectedSize !== null && stat.size !== expectedSize) {
    throw new Error(`Downloaded size mismatch for ${s3Key}: expected ${expectedSize} bytes, got ${stat.size} bytes`);
  }

  console.info(`[VideoConversion] Downloaded ${s3Key} successfully (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
  return stat.size;
}

/**
 * Uploads local file to S3 via robust multipart chunked upload.
 */
async function uploadM4vToS3Multipart(filePath, targetKey, contentType = 'video/mp4') {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
  const numParts = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

  console.info(`[VideoConversion] Starting multipart S3 upload for ${targetKey} (${(fileSize / (1024 * 1024)).toFixed(2)} MB, ${numParts} parts)...`);

  const createRes = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: targetKey,
      ContentType: contentType,
      CacheControl: 'private, max-age=31536000',
      Metadata: { 'encode-profile': IOS_ENCODE_PROFILE },
    })
  );
  const uploadId = createRes.UploadId;

  const parts = [];
  const fd = fs.openSync(filePath, 'r');

  try {
    for (let i = 0; i < numParts; i++) {
      const partNumber = i + 1;
      const start = i * CHUNK_SIZE;
      const length = Math.min(CHUNK_SIZE, fileSize - start);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);

      let success = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const partRes = await s3Client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: targetKey,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: buffer,
            })
          );
          parts.push({ PartNumber: partNumber, ETag: partRes.ETag });
          success = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[VideoConversion] Part ${partNumber}/${numParts} attempt ${attempt} failed: ${err.message}. Retrying...`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }

      if (!success) {
        throw new Error(`Failed to upload part ${partNumber} after 3 attempts: ${lastErr?.message}`);
      }
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: targetKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );

    console.info(`[VideoConversion] S3 multipart upload completed: ${targetKey}`);
  } catch (err) {
    console.error(`[VideoConversion] S3 multipart upload failed:`, err.message);
    try {
      await s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: targetKey,
          UploadId: uploadId,
        })
      );
    } catch (_) {}
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Derives the destination iOS M4V object key from the original S3 key.
 */
function getM4vKeyForOriginal(originalKey) {
  if (typeof originalKey !== 'string') return '';
  const clean = originalKey.trim().replace(/\\/g, '/');
  const ext = path.extname(clean);
  const baseWithoutExt = ext ? clean.slice(0, -ext.length) : clean;
  if (baseWithoutExt.endsWith('_ios')) {
    return `${baseWithoutExt}.m4v`;
  }
  return `${baseWithoutExt}_ios.m4v`;
}

/**
 * Verifies if the S3 key represents an eligible convertible video.
 */
function isConvertibleVideoKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase().trim();
  return (
    lower.startsWith('videos/') ||
    lower.startsWith('live_records/')
  ) && (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.m4v')
  );
}

/**
 * Synchronizes conversion completion with Course and Recording documents in MongoDB.
 */
async function syncDatabaseRecords(originalKey, m4vKey, status, errorMessage = '') {
  try {
    // 1. Update Course records
    const courses = await Course.find({
      $or: [
        { 'modules.lessons.s3Key': originalKey },
        { 'modules.lessons.videoS3Key': originalKey },
        { 'modules.lessons.videoParts.s3Key': originalKey },
      ],
    });

    for (const course of courses) {
      let modified = false;
      for (const mod of course.modules || []) {
        for (const lesson of mod.lessons || []) {
          if (lesson.s3Key === originalKey || lesson.videoS3Key === originalKey) {
            lesson.m4vS3Key = status === 'completed' ? m4vKey : (lesson.m4vS3Key || '');
            lesson.m4vStorageProvider = status === 'completed' ? 's3' : (lesson.m4vStorageProvider || '');
            lesson.m4vConversionStatus = status;
            lesson.m4vConversionError = errorMessage;
            modified = true;
          }
          for (const vp of lesson.videoParts || []) {
            if (vp.s3Key === originalKey) {
              vp.m4vS3Key = status === 'completed' ? m4vKey : (vp.m4vS3Key || '');
              vp.m4vStorageProvider = status === 'completed' ? 's3' : (vp.m4vStorageProvider || '');
              vp.m4vConversionStatus = status;
              vp.m4vConversionError = errorMessage;
              modified = true;
            }
          }
        }
      }
      if (modified) {
        await course.save();
        console.info(`[VideoConversion] Synced Course ${course.courseId || course._id} with M4V status: ${status}`);
      }
    }

    // 2. Update Recording records
    const recordings = await Recording.find({ s3Key: originalKey });
    for (const rec of recordings) {
      rec.m4vS3Key = status === 'completed' ? m4vKey : (rec.m4vS3Key || '');
      rec.m4vStorageProvider = status === 'completed' ? 's3' : (rec.m4vStorageProvider || '');
      rec.m4vConversionStatus = status;
      rec.m4vConversionError = errorMessage;
      await rec.save();
      console.info(`[VideoConversion] Synced Recording ${rec._id} with M4V status: ${status}`);
    }
  } catch (syncErr) {
    console.warn(`[VideoConversion] Database sync warning for ${originalKey}:`, syncErr.message);
  }
}

/**
 * Main worker function: converts an MP4 (or WebM/MOV) video in S3 into an iOS FastStart MP4/M4V.
 *
 * Implements the full 10-step safe workflow:
 * 1. Checks binaries and idempotency.
 * 2. Downloads original S3 object to temporary working directory.
 * 3. Probes input and re-encodes to the iOS seek-safe profile (see buildIosEncodeArgs).
 * 4. Validates output with ffprobe and moov-before-mdat atom inspection.
 * 5. Uploads optimized output to S3 via multipart chunked upload.
 * 6. Verifies S3 head of uploaded object.
 * 7. Updates database records.
 * 8. Cleans up temporary files in finally block.
 * 9. Never deletes or mutates original S3 object.
 */
async function convertMp4ToM4v(originalS3Key, options = {}) {
  const cleanKey = String(originalS3Key || '').trim();
  if (!isConvertibleVideoKey(cleanKey)) {
    throw new Error(`Invalid video key for conversion: ${cleanKey}`);
  }

  // 1. Validate FFmpeg/FFprobe availability
  const binStatus = checkBinaryAvailability();
  if (!binStatus.available) {
    throw new Error(`Cannot perform video conversion: ${binStatus.error}`);
  }

  const targetM4vKey = options.targetKey || getM4vKeyForOriginal(cleanKey);

  console.info(`[VideoConversion] Starting conversion process:`, {
    original: cleanKey,
    target: targetM4vKey,
  });

  // Check if output already exists in S3 (idempotency check)
  if (!options.force) {
    try {
      const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: targetM4vKey }));
      const madeWithCurrentProfile = head.Metadata?.['encode-profile'] === IOS_ENCODE_PROFILE;
      if (head.ContentLength && head.ContentLength > 0 && !madeWithCurrentProfile) {
        console.info(`[VideoConversion] Existing M4V for ${cleanKey} was made with an older profile; re-encoding.`);
      }
      if (head.ContentLength && head.ContentLength > 0 && madeWithCurrentProfile) {
        console.info(`[VideoConversion] Target M4V already exists in S3 (${head.ContentLength} bytes). Marking completed.`);
        await VideoConversion.findOneAndUpdate(
          { originalS3Key: cleanKey },
          {
            $set: {
              m4vS3Key: targetM4vKey,
              status: 'completed',
              fileSize: head.ContentLength,
              completedAt: new Date(),
              error: '',
            },
          },
          { upsert: true, new: true }
        );
        await syncDatabaseRecords(cleanKey, targetM4vKey, 'completed');
        return {
          success: true,
          originalKey: cleanKey,
          m4vS3Key: targetM4vKey,
          reusedExisting: true,
        };
      }
    } catch (_) {
      // Object does not exist, proceed with conversion
    }
  }

  // Update conversion record to 'processing'
  await VideoConversion.findOneAndUpdate(
    { originalS3Key: cleanKey },
    {
      $set: {
        status: 'processing',
        lastAttemptAt: new Date(),
        error: '',
      },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true }
  );
  await syncDatabaseRecords(cleanKey, targetM4vKey, 'processing');

  const workDir = path.join(__dirname, '../scratch/temp-conversions');
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = path.extname(cleanKey) || '.mp4';
  const localInput = path.join(workDir, `${jobId}-input${ext}`);
  const localOutput = path.join(workDir, `${jobId}-output.mp4`);

  try {
    // 2. Download original S3 MP4 to local working directory
    await downloadS3Object(cleanKey, localInput);

    // 3. Probe input video codecs, pixel formats, and frame rate
    const ffprobeCmd = options.ffprobePath || process.env.FFPROBE_PATH || 'ffprobe';
    const ffmpegCmd = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';

    let inVideoCodec = 'unknown';
    let inAudioCodec = 'unknown';
    let inPixFmt = 'unknown';
    let inFps = 30;

    try {
      const probeData = await probeMedia(localInput, ffprobeCmd);
      const vStream = probeData.streams?.find((s) => s.codec_type === 'video');
      const aStream = probeData.streams?.find((s) => s.codec_type === 'audio');
      if (vStream?.codec_name) inVideoCodec = vStream.codec_name;
      if (vStream?.pix_fmt) inPixFmt = vStream.pix_fmt;
      if (vStream?.avg_frame_rate || vStream?.r_frame_rate) {
        inFps = vStream.avg_frame_rate || vStream.r_frame_rate;
      }
      if (aStream?.codec_name) inAudioCodec = aStream.codec_name;
    } catch (probeErr) {
      console.warn(`[VideoConversion] Could not pre-probe ${cleanKey}, proceeding with standard remux:`, probeErr.message);
    }

    console.info(`[VideoConversion] Input codecs: video=${inVideoCodec} (pix_fmt=${inPixFmt}, fps=${inFps}), audio=${inAudioCodec}`);

    // Always re-encode: a stream copy keeps the long keyframe gaps that freeze iOS seeking.
    console.info(`[VideoConversion] Running iOS seek-safe H.264 encode (${IOS_ENCODE_PROFILE}) for ${cleanKey}...`);
    const ffmpegArgs = buildIosEncodeArgs(localInput, localOutput, inFps, options);

    // 4. Run FFmpeg
    await runFfmpeg(ffmpegArgs, {
      timeoutMs: options.timeoutMs || 3 * 60 * 60 * 1000,
      ffmpegCmd,
    });

    // 5. Validate generated output with ffprobe
    console.info(`[VideoConversion] Validating output with ffprobe...`);
    const outputProbe = await probeMedia(localOutput, ffprobeCmd);
    const duration = parseFloat(outputProbe.format?.duration || '0');
    if (duration <= 0 || isNaN(duration)) {
      throw new Error('Validation failed: output video has invalid or missing duration.');
    }

    const outVStream = outputProbe.streams?.find((s) => s.codec_type === 'video');
    const outAStream = outputProbe.streams?.find((s) => s.codec_type === 'audio');
    if (!outVStream || (outVStream.codec_name !== 'h264' && outVStream.codec_name !== 'avc1')) {
      throw new Error(`Validation failed: expected H.264 video, got ${outVStream?.codec_name || 'none'}`);
    }
    if (outAStream && outAStream.codec_name !== 'aac') {
      throw new Error(`Validation failed: expected AAC audio, got ${outAStream.codec_name}`);
    }

    // 6. Verify FastStart moov placement (moov must appear before mdat)
    if (!hasFastStartMoov(localOutput)) {
      throw new Error('Validation failed: MP4/M4V moov atom is not positioned before media data (faststart missing).');
    }

    const stat = fs.statSync(localOutput);
    if (stat.size <= 0) {
      throw new Error('Validation failed: output file size is 0 bytes.');
    }

    console.info(`[VideoConversion] Output validated successfully: ${(stat.size / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(1)}s, FastStart verified`);

    // 7. Upload to S3
    await uploadM4vToS3Multipart(localOutput, targetM4vKey, 'video/mp4');

    // 8. Verify S3 head of uploaded object
    const uploadedHead = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: targetM4vKey }));
    if (!uploadedHead.ContentLength || uploadedHead.ContentLength <= 0) {
      throw new Error(`S3 verification failed: uploaded object ${targetM4vKey} is missing or empty`);
    }

    // 9. Update database models
    await VideoConversion.findOneAndUpdate(
      { originalS3Key: cleanKey },
      {
        $set: {
          m4vS3Key: targetM4vKey,
          status: 'completed',
          duration,
          fileSize: stat.size,
          completedAt: new Date(),
          error: '',
        },
      },
      { upsert: true, new: true }
    );
    await syncDatabaseRecords(cleanKey, targetM4vKey, 'completed');

    console.info(`[VideoConversion] Successfully converted and persisted ${cleanKey} -> ${targetM4vKey}`);

    return {
      success: true,
      originalKey: cleanKey,
      m4vS3Key: targetM4vKey,
      duration,
      fileSize: stat.size,
    };
  } catch (err) {
    console.error(`[VideoConversion] Error processing ${cleanKey}:`, err.message);
    await VideoConversion.findOneAndUpdate(
      { originalS3Key: cleanKey },
      {
        $set: {
          status: 'failed',
          error: err.message,
        },
      },
      { upsert: true, new: true }
    );
    await syncDatabaseRecords(cleanKey, targetM4vKey, 'failed', err.message);
    throw err;
  } finally {
    // 10. Clean up temporary files
    try {
      if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
    } catch (_) {}
    try {
      if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput);
    } catch (_) {}
  }
}

// In-memory set to prevent duplicate concurrent conversions of the same video key
const inFlightConversions = new Set();

// Re-encoding is CPU heavy, so run a limited number at a time (default 1).
// Without this, batch-convert would start an ffmpeg process for every video at once.
const MAX_CONCURRENT_CONVERSIONS = Math.max(1, parseInt(process.env.VIDEO_CONVERSION_CONCURRENCY, 10) || 1);
const conversionQueue = [];
let runningConversions = 0;

function runNextConversion() {
  while (runningConversions < MAX_CONCURRENT_CONVERSIONS && conversionQueue.length > 0) {
    const { key, options } = conversionQueue.shift();
    runningConversions += 1;
    convertMp4ToM4v(key, options)
      .catch((err) => {
        console.error(`[VideoConversion] Background conversion failed for ${key}:`, err.message);
      })
      .finally(() => {
        runningConversions -= 1;
        inFlightConversions.delete(key);
        setImmediate(runNextConversion);
      });
  }
}

/**
 * Enqueues a video for background conversion without blocking the caller.
 */
function enqueueConversion(s3Key, options = {}) {
  const cleanKey = String(s3Key || '').trim();
  if (!isConvertibleVideoKey(cleanKey)) {
    return false;
  }

  if (inFlightConversions.has(cleanKey)) {
    console.info(`[VideoConversion] Conversion already queued or running for ${cleanKey}, skipping duplicate.`);
    return true;
  }

  inFlightConversions.add(cleanKey);
  conversionQueue.push({ key: cleanKey, options });
  console.info(`[VideoConversion] Queued ${cleanKey} (queue length: ${conversionQueue.length}, running: ${runningConversions})`);
  setImmediate(runNextConversion);

  return true;
}

/**
 * Retries a failed or stalled conversion.
 */
async function retryConversion(s3Key) {
  const cleanKey = String(s3Key || '').trim();
  // Do not clear an in-flight entry: that would start a second ffmpeg for the same video.
  return enqueueConversion(cleanKey, { force: true });
}

/**
 * Retrieves the current conversion status for an S3 video key.
 */
async function getConversionStatus(s3Key) {
  const cleanKey = String(s3Key || '').trim();
  const record = await VideoConversion.findOne({ originalS3Key: cleanKey }).lean();
  if (!record) {
    return {
      originalS3Key: cleanKey,
      status: 'none',
      m4vS3Key: '',
      error: '',
    };
  }
  return {
    originalS3Key: record.originalS3Key,
    m4vS3Key: record.m4vS3Key,
    status: record.status,
    error: record.error,
    duration: record.duration,
    fileSize: record.fileSize,
    attempts: record.attempts,
    lastAttemptAt: record.lastAttemptAt,
    completedAt: record.completedAt,
  };
}

module.exports = {
  checkBinaryAvailability,
  calculateGopOptions,
  buildIosEncodeArgs,
  IOS_ENCODE_PROFILE,
  hasFastStartMoov,
  probeMedia,
  runFfmpeg,
  downloadS3Object,
  uploadM4vToS3Multipart,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
  convertMp4ToM4v,
  enqueueConversion,
  retryConversion,
  getConversionStatus,
  inFlightConversions,
};


