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
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
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

async function probeUrl(url, ffprobeCmd = 'ffprobe') {
  return new Promise((resolve, reject) => {
    execFile(ffprobeCmd, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      url,
    ], (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

async function uploadFileToS3Multipart(filePath, targetKey, contentType = 'video/mp4') {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
  const numParts = Math.ceil(fileSize / CHUNK_SIZE);

  console.log(`[MediaRemuxer] Starting multipart upload for ${targetKey} (${(fileSize / (1024 * 1024)).toFixed(2)} MB, ${numParts} parts)...`);

  const createRes = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: targetKey,
    ContentType: contentType,
    CacheControl: 'private, max-age=31536000',
  }));
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
          const partRes = await s3.send(new UploadPartCommand({
            Bucket: bucket,
            Key: targetKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: buffer,
          }));
          parts.push({ PartNumber: partNumber, ETag: partRes.ETag });
          success = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[MediaRemuxer] Part ${partNumber}/${numParts} attempt ${attempt} failed: ${err.message}. Retrying...`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }

      if (!success) {
        throw new Error(`Failed to upload part ${partNumber} after 3 attempts: ${lastErr?.message}`);
      }
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await s3.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: targetKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));

    console.log(`[MediaRemuxer] Multipart upload completed successfully: ${targetKey}`);
  } catch (err) {
    console.error(`[MediaRemuxer] Upload failed, aborting multipart upload:`, err.message);
    try {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: targetKey,
        UploadId: uploadId,
      }));
    } catch (_) {}
    throw err;
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

  const ffprobeCmd = options.ffprobePath || 'ffprobe';
  let inputCodec = 'h264';
  try {
    const inputProbe = await probeUrl(downloadUrl, ffprobeCmd);
    const inVStream = inputProbe.streams?.find((s) => s.codec_type === 'video');
    if (inVStream?.codec_name) inputCodec = inVStream.codec_name;
  } catch (probeErr) {
    console.warn('[MediaRemuxer] Could not pre-probe input codec, defaulting:', probeErr.message);
  }

  console.log(`[MediaRemuxer] Input video codec: ${inputCodec}. Remuxing original recording from S3...`);
  const ffmpegCmd = options.ffmpegPath || 'ffmpeg';

  // If input video stream is already H.264, use stream copy (-c:v copy) for instantaneous, lossless remuxing!
  const videoEncodingArgs = inputCodec === 'h264'
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', options.preset || 'medium', '-crf', String(options.crf ?? 23), '-pix_fmt', 'yuv420p'];

  const ffmpegArgs = [
    '-y',
    '-i', downloadUrl,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    ...videoEncodingArgs,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    localOutput,
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
  const probeData = await probeUrl(localOutput, ffprobeCmd);

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

  // 3. Upload indexed copy to S3 via robust multipart chunked upload
  const targetKey = `videos/${Date.now()}-${outputName}`;
  await uploadFileToS3Multipart(localOutput, targetKey, 'video/mp4');

  try {
    fs.unlinkSync(localOutput);
  } catch (_) {}

  console.log('[MediaRemuxer] Completed successfully in', Math.round((Date.now() - startTime) / 1000), 'seconds.');
  return {
    success: true,
    originalKey: s3Key,
    processedKey: targetKey,
    duration,
    sizeBytes: stat.size,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name || null,
    fastStart: true,
  };
}

/**
 * Audit all courses in MongoDB for WebM video assets missing MP4 fallbacks,
 * remux them to FastStart MP4 (H.264 + AAC), upload to S3, and update database records.
 */
async function remuxAndLinkAllWebmLessons(options = {}) {
  const Course = require('../models/Course');
  const shouldDisconnect = mongoose.connection.readyState === 0;
  if (shouldDisconnect) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  try {
    const courses = await Course.find({});
    const remuxCache = new Map();
    let totalUpdated = 0;

    for (const course of courses) {
      let courseModified = false;
      for (const mod of course.modules || []) {
        for (const lesson of mod.lessons || []) {
          for (const vp of lesson.videoParts || []) {
            const key = String(vp.s3Key || '').trim();
            if (key.toLowerCase().endsWith('.webm') && (!vp.mp4S3Key || options.force)) {
              console.log(`\nFound WebM lesson part needing MP4 fallback: Course ${course.courseId}, Lesson "${lesson.lessonTitle}", S3Key: ${key}`);
              let processedKey = remuxCache.get(key);
              if (!processedKey) {
                const remuxResult = await remuxAndVerify(key, options);
                processedKey = remuxResult.processedKey;
                remuxCache.set(key, processedKey);
              }
              vp.mp4S3Key = processedKey;
              vp.mp4StorageProvider = 's3';
              courseModified = true;
              totalUpdated++;
            }
          }

          // Also check top-level lesson videoS3Key/s3Key if WebM
          const topKey = String(lesson.videoS3Key || lesson.s3Key || '').trim();
          if (topKey.toLowerCase().endsWith('.webm') && (!lesson.mp4S3Key || options.force)) {
            let processedKey = remuxCache.get(topKey);
            if (!processedKey) {
              const remuxResult = await remuxAndVerify(topKey, options);
              processedKey = remuxResult.processedKey;
              remuxCache.set(topKey, processedKey);
            }
            lesson.mp4S3Key = processedKey;
            lesson.mp4StorageProvider = 's3';
            courseModified = true;
            totalUpdated++;
          }
        }
      }

      if (courseModified) {
        course.markModified('modules');
        await course.save();
        console.log(`[MediaRemuxer] Successfully saved MP4 fallback metadata for course: ${course.courseId}`);
      }
    }

    console.log(`\n[MediaRemuxer] Complete! Total WebM items updated with verified MP4 fallbacks: ${totalUpdated}`);
    return { success: true, totalUpdated };
  } finally {
    if (shouldDisconnect) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  remuxAndLinkAllWebmLessons().catch(err => {
    console.error('Remux error:', err);
    process.exit(1);
  });
}

module.exports = { remuxAndVerify, hasFastStartMoov, remuxAndLinkAllWebmLessons };

