const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function inspectMatches() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const Course = require('../models/Course');
  const LiveClass = require('../models/LiveClass');

  console.log('\n--- LIVE CLASSES ---');
  const liveClasses = await LiveClass.find({
    $or: [
      { recordingFileUrl: /webm/i },
      { s3Key: /webm/i }
    ]
  }).lean();
  for (const lc of liveClasses) {
    console.log(`LiveClass ID: ${lc._id}, title: ${lc.title}, courseId: ${lc.courseId}, moduleId: ${lc.moduleId}`);
    console.log(`  recordingFileUrl: ${lc.recordingFileUrl}`);
    console.log(`  s3Key: ${lc.s3Key}`);
    console.log(`  duration: ${lc.duration}, status: ${lc.status}`);
  }

  console.log('\n--- COURSES ---');
  const courses = await Course.find({}).lean();
  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const les of m.lessons || []) {
        const lesStr = JSON.stringify(les);
        if (/webm/i.test(lesStr)) {
          console.log(`\nCourse: "${c.courseTitle || c.title}" (ID: ${c._id}, courseId: ${c.courseId})`);
          console.log(`Module: "${m.name || m.title}" (ID: ${m._id})`);
          console.log(`Lesson: "${les.lessonTitle || les.title}" (ID: ${les._id})`);
          console.log(`  lessonType: ${les.lessonType}`);
          console.log(`  videoUrl: ${les.videoUrl}`);
          console.log(`  s3Key: ${les.s3Key}`);
          console.log(`  videoS3Key: ${les.videoS3Key}`);
          console.log(`  meetingUrl: ${les.meetingUrl}`);
          console.log(`  videoFormat: ${les.videoFormat}`);
          if (les.videoParts && les.videoParts.length) {
            console.log('  videoParts:');
            for (const vp of les.videoParts) {
              console.log(`    - s3Key: ${vp.s3Key}, mp4S3Key: ${vp.mp4S3Key}, url: ${vp.url}, fileName: ${vp.fileName}`);
            }
          }
        }
      }
    }
  }

  await mongoose.disconnect();
}

inspectMatches().catch(err => { console.error(err); process.exit(1); });

