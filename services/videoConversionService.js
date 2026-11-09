const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
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
 * Validates whether binary file has 'moov' atom before 'mdat' atom (FastStart).
 */
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

/**
 * Runs ffprobe to extract format and stream metadata as JSON.
 */
async function probeMedia(target, ffprobeCmd = 'ffprobe') {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobeCmd,
      [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-print_format', 'json',
        target,
      ],
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`ffprobe failed: ${err.message}. ${stderr || ''}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe JSON output: ${e.message}`));
        }
      }
    );
  });
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
 * Main worker function: converts an MP4 (or WebM/MOV) video in S3 into an iOS FastStart M4V.
 */
async function convertMp4ToM4v(originalS3Key, options = {}) {
  const cleanKey = String(originalS3Key || '').trim();
  if (!isConvertibleVideoKey(cleanKey)) {
    throw new Error(`Invalid video key for conversion: ${cleanKey}`);
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
      if (head.ContentLength && head.ContentLength > 0) {
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

  const workDir = path.join(__dirname, '../scratch');
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const baseFileName = path.basename(targetM4vKey);
  const localOutput = path.join(workDir, `${Date.now()}-${baseFileName}`);

  try {
    // 1. Generate presigned URL for download from S3
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
      }),
      { expiresIn: 7200 }
    );

    const ffprobeCmd = options.ffprobePath || 'ffprobe';
    const ffmpegCmd = options.ffmpegPath || 'ffmpeg';

    // 2. Probe input video codecs and pixel formats
    let inVideoCodec = 'unknown';
    let inAudioCodec = 'unknown';
    let inPixFmt = 'unknown';
    try {
      const probeData = await probeMedia(downloadUrl, ffprobeCmd);
      const vStream = probeData.streams?.find((s) => s.codec_type === 'video');
      const aStream = probeData.streams?.find((s) => s.codec_type === 'audio');
      if (vStream?.codec_name) inVideoCodec = vStream.codec_name;
      if (vStream?.pix_fmt) inPixFmt = vStream.pix_fmt;
      if (aStream?.codec_name) inAudioCodec = aStream.codec_name;
    } catch (probeErr) {
      console.warn(`[VideoConversion] Could not pre-probe ${cleanKey}, proceeding with fallback:`, probeErr.message);
    }

    console.info(`[VideoConversion] Input codecs: video=${inVideoCodec} (pix_fmt=${inPixFmt}), audio=${inAudioCodec}`);

    // If input video stream is already H.264 (yuv420p), copy video stream for lossless, zero-degradation remux
    const canCopyVideo = inVideoCodec === 'h264' && (inPixFmt === 'yuv420p' || inPixFmt === 'unknown');
    const videoArgs = canCopyVideo
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', options.preset || 'medium', '-crf', '22', '-pix_fmt', 'yuv420p'];

    // If input audio stream is already AAC, copy audio stream; otherwise transcode to standard AAC-LC 128k stereo
    const canCopyAudio = inAudioCodec === 'aac';
    const audioArgs = canCopyAudio
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'];

    // Fast-start optimization: -movflags +faststart places 'moov' atom at the start of container
    const ffmpegArgs = [
      '-y',
      '-i', downloadUrl,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      ...videoArgs,
      ...audioArgs,
      '-movflags', '+faststart',
      '-f', 'mp4',
      localOutput,
    ];

    console.info(`[VideoConversion] Spawning FFmpeg...`);
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegCmd, ffmpegArgs, { stdio: 'inherit' });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with error code ${code}`));
      });
      proc.on('error', reject);
    });

    // 3. Validate generated output with ffprobe
    console.info(`[VideoConversion] Validating output M4V with ffprobe...`);
    const outputProbe = await probeMedia(localOutput, ffprobeCmd);
    const duration = parseFloat(outputProbe.format?.duration || '0');
    if (duration <= 0 || isNaN(duration)) {
      throw new Error('Validation failed: output video has invalid or missing duration.');
    }

    const outVStream = outputProbe.streams?.find((s) => s.codec_type === 'video');
    const outAStream = outputProbe.streams?.find((s) => s.codec_type === 'audio');
    if (!outVStream || outVStream.codec_name !== 'h264') {
      throw new Error(`Validation failed: expected H.264 video, got ${outVStream?.codec_name || 'none'}`);
    }
    if (outAStream && outAStream.codec_name !== 'aac') {
      throw new Error(`Validation failed: expected AAC audio, got ${outAStream.codec_name}`);
    }

    // 4. Verify FastStart moov placement
    if (!hasFastStartMoov(localOutput)) {
      throw new Error('Validation failed: MP4/M4V moov atom is not positioned before media data (faststart missing).');
    }

    const stat = fs.statSync(localOutput);
    console.info(`[VideoConversion] Output validated successfully: ${(stat.size / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(1)}s`);

    // 5. Upload to S3
    await uploadM4vToS3Multipart(localOutput, targetM4vKey, 'video/mp4');

    // 6. Update database models
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
    try {
      if (fs.existsSync(localOutput)) {
        fs.unlinkSync(localOutput);
      }
    } catch (_) {}
  }
}

// In-memory queue to prevent duplicate concurrent conversions of the same video key
const inFlightConversions = new Set();

/**
 * Enqueues a video for background conversion without blocking the caller.
 */
function enqueueConversion(s3Key, options = {}) {
  const cleanKey = String(s3Key || '').trim();
  if (!isConvertibleVideoKey(cleanKey)) {
    return false;
  }

  if (inFlightConversions.has(cleanKey)) {
    console.info(`[VideoConversion] Conversion already in flight for ${cleanKey}, skipping duplicate.`);
    return true;
  }

  inFlightConversions.add(cleanKey);

  // Fire asynchronously
  setImmediate(async () => {
    try {
      await convertMp4ToM4v(cleanKey, options);
    } catch (err) {
      console.error(`[VideoConversion] Background conversion failed for ${cleanKey}:`, err.message);
    } finally {
      inFlightConversions.delete(cleanKey);
    }
  });

  return true;
}

/**
 * Retries a failed or stalled conversion.
 */
async function retryConversion(s3Key) {
  const cleanKey = String(s3Key || '').trim();
  inFlightConversions.delete(cleanKey);
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
  hasFastStartMoov,
  probeMedia,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
  convertMp4ToM4v,
  enqueueConversion,
  retryConversion,
  getConversionStatus,
};

