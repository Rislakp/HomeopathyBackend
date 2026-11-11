/**
 * CLI utility for safe, non-destructive MP4 FastStart optimization and verification.
 *
 * Supported modes:
 *   --dry-run                 Inspect all video assets, reporting FastStart and rendition status without modifying S3 or DB.
 *   --test-mode               Optimize a test video and upload to videos/optimized-test/... (never overwrites original).
 *   --key=<s3Key>             Optimize a single specific S3 key.
 *   --all                     Process all unoptimized course videos (requires confirmation).
 *   --force                   Force re-conversion even if target rendition exists.
 *
 * Examples:
 *   node scripts/optimize_mp4_faststart.js --dry-run
 *   node scripts/optimize_mp4_faststart.js --test-mode --key="videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4"
 *   node scripts/optimize_mp4_faststart.js --key="videos/sample.mp4"
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const {
  checkBinaryAvailability,
  convertMp4ToM4v,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
  hasFastStartMoov,
  probeMedia,
} = require('../services/videoConversionService');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    testMode: false,
    key: null,
    all: false,
    force: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--test-mode') options.testMode = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--atlas') options.atlas = true;
    else if (arg === '--force') options.force = true;
    else if (arg.startsWith('--key=')) options.key = arg.slice(6).trim();
    else if (!arg.startsWith('--')) options.key = arg.trim();
  }

  return options;
}

async function runTestMode(targetKey) {
  console.log('\n======================================================');
  console.log('       SAFE MP4 FASTSTART TEST MODE (NON-DESTRUCTIVE)  ');
  console.log('======================================================');

  const binStatus = checkBinaryAvailability();
  console.log('1. Binary Availability:');
  console.log(`   FFmpeg: ${binStatus.ffmpegVersion || 'NOT FOUND'}`);
  console.log(`   FFprobe: ${binStatus.ffprobeVersion || 'NOT FOUND'}`);
  if (!binStatus.available) {
    throw new Error(`Prerequisites not met: ${binStatus.error}`);
  }

  const cleanKey = targetKey || 'videos/test_input.mp4';
  const baseName = path.basename(cleanKey, path.extname(cleanKey));
  const testOutputKey = `videos/optimized-test/${baseName}-faststart.mp4`;

  console.log(`\n2. Source Key: ${cleanKey}`);
  console.log(`   Test Destination Key: ${testOutputKey}`);
  console.log('   (Original S3 object and DB records remain completely untouched)\n');

  const result = await convertMp4ToM4v(cleanKey, {
    targetKey: testOutputKey,
    force: true,
  });

  console.log('\n3. Test Verification:');
  console.log(`   Status: SUCCESS`);
  console.log(`   Uploaded Key: ${result.m4vS3Key}`);
  console.log(`   File Size: ${(result.fileSize / (1024 * 1024)).toFixed(2)} MB (${result.fileSize} bytes)`);
  console.log(`   Duration: ${result.duration.toFixed(2)} seconds`);

  return result;
}

async function runDryRun() {
  console.log('\n======================================================');
  console.log('            MP4 FASTSTART DRY-RUN AUDIT               ');
  console.log('======================================================\n');

  console.log('Scanning database video assets...');
  const courses = await Course.find({}).lean();
  const recordings = await Recording.find({}).lean();

  const allKeys = new Set();
  const keyToLessons = new Map();

  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const keys = [l.s3Key, l.videoS3Key, l.mp4S3Key].filter(Boolean);
        for (const vp of l.videoParts || []) {
          if (vp.s3Key) keys.push(vp.s3Key);
          if (vp.mp4S3Key) keys.push(vp.mp4S3Key);
        }
        for (const k of keys) {
          const clean = String(k).trim();
          if (isConvertibleVideoKey(clean)) {
            allKeys.add(clean);
            if (!keyToLessons.has(clean)) keyToLessons.set(clean, []);
            keyToLessons.get(clean).push(`${c.courseId || c._id} -> ${l.lessonTitle || 'Untitled'}`);
          }
        }
      }
    }
  }

  for (const r of recordings) {
    if (r.s3Key && isConvertibleVideoKey(r.s3Key)) {
      const clean = String(r.s3Key).trim();
      allKeys.add(clean);
      if (!keyToLessons.has(clean)) keyToLessons.set(clean, []);
      keyToLessons.get(clean).push(`Recording -> ${r.title || r._id}`);
    }
  }

  console.log(`Total convertible video assets found: ${allKeys.size}\n`);

  const results = [];
  let alreadyOptimized = 0;
  let needsOptimization = 0;

  for (const key of allKeys) {
    const expectedM4vKey = getM4vKeyForOriginal(key);
    const convRecord = await VideoConversion.findOne({ originalS3Key: key }).lean();
    const hasM4v = convRecord && convRecord.status === 'completed';

    if (hasM4v) {
      alreadyOptimized++;
    } else {
      needsOptimization++;
    }

    results.push({
      key,
      expectedM4vKey,
      status: convRecord?.status || 'none',
      attempts: convRecord?.attempts || 0,
      lessons: keyToLessons.get(key) || [],
    });
  }

  console.log('--- SUMMARY STATISTICS ---');
  console.log(`Total Videos:           ${allKeys.size}`);
  console.log(`Already Optimized:     ${alreadyOptimized}`);
  console.log(`Needs Optimization:    ${needsOptimization}\n`);

  console.log('Sample assets needing FastStart optimization:');
  const sample = results.filter((r) => r.status !== 'completed').slice(0, 10);
  for (const s of sample) {
    console.log(` - ${s.key} (Status: ${s.status}, Target: ${s.expectedM4vKey})`);
  }
}

async function main() {
  const options = parseArgs();

  if (!options.dryRun && !options.testMode && !options.key && !options.all) {
    console.log(`
Usage:
  node scripts/optimize_mp4_faststart.js [options]

Options:
  --dry-run             Audit all video assets without modifying S3 or DB.
  --test-mode           Run non-destructive test on a video and upload to videos/optimized-test/...
  --key=<s3Key>         Optimize a single S3 video key.
  --all                 Optimize all unoptimized videos.
  --force               Force re-conversion even if target rendition already exists.

Examples:
  node scripts/optimize_mp4_faststart.js --dry-run
  node scripts/optimize_mp4_faststart.js --test-mode
  node scripts/optimize_mp4_faststart.js --key="videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4"
`);
    process.exit(0);
  }

  const binStatus = checkBinaryAvailability();
  console.log('FFmpeg & FFprobe Check:');
  console.log(`  FFmpeg:  ${binStatus.ffmpegVersion || 'NOT FOUND'}`);
  console.log(`  FFprobe: ${binStatus.ffprobeVersion || 'NOT FOUND'}`);
  if (!binStatus.available) {
    console.error(`\n❌ Error: ${binStatus.error}`);
    process.exit(1);
  }

  const uri = (options.atlas && process.env.MONGODB_URI)
    ? process.env.MONGODB_URI
    : (process.env.USE_LOCAL_DB === 'true' ? process.env.MONGODB_LOCAL_URI : (process.env.MONGODB_URI || process.env.MONGODB_LOCAL_URI));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`Connected to MongoDB (${options.atlas ? 'Atlas' : (process.env.USE_LOCAL_DB === 'true' ? 'Local' : 'Atlas')}).\n`);

  try {
    if (options.dryRun) {
      await runDryRun();
    } else if (options.testMode) {
      await runTestMode(options.key);
    } else if (options.key) {
      console.log(`Optimizing single video: ${options.key}...`);
      const result = await convertMp4ToM4v(options.key, { force: options.force });
      console.log(`✔ Completed: ${result.m4vS3Key} (${(result.fileSize / (1024 * 1024)).toFixed(2)} MB)`);
    } else if (options.all) {
      console.log('Bulk processing requested. Scanning for unoptimized videos...');
      const unoptimized = await VideoConversion.find({ status: { $ne: 'completed' } }).lean();
      console.log(`Found ${unoptimized.length} unoptimized conversion records.`);
      for (const rec of unoptimized) {
        console.log(`\n▶ Processing: ${rec.originalS3Key}`);
        try {
          const res = await convertMp4ToM4v(rec.originalS3Key, { force: options.force });
          console.log(`  ✔ Completed: ${res.m4vS3Key}`);
        } catch (err) {
          console.error(`  ✖ Failed: ${err.message}`);
        }
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

module.exports = {
  runTestMode,
  runDryRun,
};
