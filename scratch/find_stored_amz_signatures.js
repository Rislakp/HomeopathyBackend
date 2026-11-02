const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Course = require('../models/Course');
  const courses = await Course.find({
    $or: [
      { 'modules.lessons.videoUrl': { $regex: 'X-Amz-Signature' } },
      { 'modules.lessons.meetingUrl': { $regex: 'X-Amz-Signature' } },
    ]
  }).lean();

  console.log(`Courses with stored X-Amz-Signature: ${courses.length}`);
  for (const c of courses) {
    console.log(`Course: ${c.courseId} (${c.courseTitle})`);
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        if ((l.videoUrl && l.videoUrl.includes('X-Amz-Signature')) || (l.meetingUrl && l.meetingUrl.includes('X-Amz-Signature'))) {
          console.log(`  Lesson: ${l.lessonTitle} (_id: ${l._id})`);
          if (l.videoUrl && l.videoUrl.includes('X-Amz-Signature')) {
            console.log(`    videoUrl contains X-Amz-Signature (starts with: ${l.videoUrl.split('?')[0]})`);
          }
          if (l.meetingUrl && l.meetingUrl.includes('X-Amz-Signature')) {
            console.log(`    meetingUrl contains X-Amz-Signature (starts with: ${l.meetingUrl.split('?')[0]})`);
          }
        }
      }
    }
  }

  process.exit(0);
}

run();

