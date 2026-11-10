const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Recording = require('../models/Recording');

async function inspectRecordings() {
  await mongoose.connect(process.env.MONGODB_URI);
  const total = await Recording.countDocuments();
  console.log(`Total Recording documents: ${total}`);

  const recordings = await Recording.find({}).lean();
  for (const r of recordings) {
    console.log(`\nRecording: "${r.lessonTitle}" (Course: "${r.courseName}", ID: ${r._id})`);
    console.log('  status:', r.status);
    console.log('  storageProvider:', r.storageProvider);
    console.log('  s3Key:', r.s3Key);
    console.log('  recordedVideoUrl:', r.recordedVideoUrl ? r.recordedVideoUrl.substring(0, 80) + '...' : '(none)');
    console.log('  streamUrl:', r.streamUrl);
    console.log('  courseId:', r.courseId);
  }

  await mongoose.disconnect();
}

inspectRecordings();
