const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../models/Course');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const courses = await Course.find({}).lean();
  let count = 0;
  courses.forEach(c => {
    (c.modules || []).forEach(m => {
      (m.lessons || []).forEach(l => {
        if ((l.videoParts && l.videoParts.length > 0) || l.videoUrl || l.s3Key || l.videoS3Key) {
          count++;
          console.log(`[${c.courseId}] "${l.lessonTitle}": top videoUrl="${l.videoUrl}", s3Key="${l.s3Key}", parts=${(l.videoParts||[]).length}`);
          (l.videoParts || []).forEach((p, idx) => {
            console.log(`   part[${idx}]: s3Key="${p.s3Key}", mp4S3Key="${p.mp4S3Key||''}"`);
          });
        }
      });
    });
  });
  console.log('Total video lessons:', count);
  await mongoose.disconnect();
}
run();
