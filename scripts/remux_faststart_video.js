/**
 * CLI utility to apply iOS FastStart (+faststart) remuxing to S3 video assets.
 * Usage:
 *   node scripts/remux_faststart_video.js <s3Key>
 *   node scripts/remux_faststart_video.js --all
 *   node scripts/remux_faststart_video.js "videos/PHARMACY-4.mp4"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const {
  convertMp4ToM4v,
  isConvertibleVideoKey,
} = require('../services/videoConversionService');

async function main() {
  const targetArg = process.argv[2];

  if (!targetArg) {
    console.log(`
Usage:
  node scripts/remux_faststart_video.js <s3Key>
  node scripts/remux_faststart_video.js --all

Examples:
  node scripts/remux_faststart_video.js "videos/PHARMACY-4.mp4"
  node scripts/remux_faststart_video.js --all
`);
    process.exit(1);
  }

  await connectDB();
  console.log('✅ Connected to MongoDB.');

  try {
    if (targetArg === '--all') {
      console.log('🔍 Scanning database for video assets...');
      const courses = await Course.find({}).lean();
      const keysToConvert = new Set();

      for (const course of courses) {
        for (const moduleItem of course.modules || []) {
          for (const lesson of moduleItem.lessons || []) {
            if (lesson.videoS3Key && isConvertibleVideoKey(lesson.videoS3Key)) {
              keysToConvert.add(lesson.videoS3Key);
            }
            if (lesson.s3Key && isConvertibleVideoKey(lesson.s3Key)) {
              keysToConvert.add(lesson.s3Key);
            }
            if (lesson.mp4S3Key && isConvertibleVideoKey(lesson.mp4S3Key)) {
              keysToConvert.add(lesson.mp4S3Key);
            }
            for (const vp of lesson.videoParts || []) {
              if (vp.s3Key && isConvertibleVideoKey(vp.s3Key)) {
                keysToConvert.add(vp.s3Key);
              }
              if (vp.mp4S3Key && isConvertibleVideoKey(vp.mp4S3Key)) {
                keysToConvert.add(vp.mp4S3Key);
              }
            }
          }
        }
      }

      const recordings = await Recording.find({}).lean();
      for (const rec of recordings) {
        if (rec.s3Key && isConvertibleVideoKey(rec.s3Key)) {
          keysToConvert.add(rec.s3Key);
        }
      }

      console.log(`Found ${keysToConvert.size} video assets in database.`);
      for (const s3Key of keysToConvert) {
        console.log(`\n▶ Remuxing: ${s3Key}`);
        try {
          const res = await convertMp4ToM4v(s3Key);
          console.log(`  ✔ Completed: ${res.m4vS3Key}`);
        } catch (err) {
          console.error(`  ✖ Failed for ${s3Key}: ${err.message}`);
        }
      }
    } else {
      const s3Key = targetArg.trim();
      console.log(`\n▶ Processing single video key: ${s3Key}`);
      const res = await convertMp4ToM4v(s3Key, { force: true });
      console.log(`\n✅ Successfully remuxed and verified FastStart for: ${s3Key}`);
      console.log(`   Output rendition: ${res.m4vS3Key}`);
    }
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

main().catch((err) => {
  console.error('Fatal error during remux execution:', err);
  process.exit(1);
});

