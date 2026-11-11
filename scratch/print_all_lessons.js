const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function printAllLessonTitles() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).toArray();
  for (const c of courses) {
    console.log(`\n========================================`);
    console.log(`COURSE: "${c.courseTitle || c.title}" (${c.courseId})`);
    for (const m of c.modules || []) {
      console.log(`  MODULE: "${m.moduleTitle || m.title || m.name}" (${m._id})`);
      for (const l of m.lessons || []) {
        console.log(`    LESSON ID: ${l._id} | TITLE: "${l.lessonTitle || l.title || l.name}" | TYPE: "${l.lessonType || l.type}" | S3: "${l.s3Key || l.videoS3Key}" | VP: ${l.videoParts?.length}`);
      }
    }
  }

  await mongoose.disconnect();
}

printAllLessonTitles().catch(console.error);
