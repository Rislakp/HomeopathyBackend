/**
 * Media Remuxing & Indexing Utility for WhiteCoat Academy
 *
 * Converts unindexed Chrome MediaRecorder WebM recordings to FastStart MP4.
 * - Lossless video copy (-c:v copy) preserving original H.264 stream.
 * - Transcodes Opus audio to AAC (-c:a aac).
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
    '-c:v', 'copy',
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

  const stat = fs.statSync(localOutput);
  console.log('[MediaRemuxer] Output validated successfully!', {
    sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
    durationFormatted: `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s`,
    streams: probeData.streams.map(s => (`${s.codec_type}:${s.codec_name}`)).join(', ')
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
    CacheControl: 'public, max-age=31536000'
  }));

  console.log('[MediaRemuxer] Completed successfully in', Math.round((Date.now() - startTime) / 1000), 'seconds.');
  return {
    success: true,
    originalKey: s3Key,
    processedKey: targetKey,
    duration,
    sizeBytes: stat.size
  };
}

module.exports = { remuxAndVerify };
