const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkRecentCourses() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).sort({ updatedAt: -1, createdAt: -1 }).toArray();
  for (const c of courses) {
    console.log(`\nCourse: "${c.courseTitle || c.title}" | ID: ${c._id} | Custom ID: ${c.courseId} | UpdatedAt: ${c.updatedAt} | CreatedAt: ${c.createdAt}`);
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        console.log(`  Module: "${m.moduleTitle || m.title || m.moduleName}" -> Lesson: "${l.lessonTitle || l.title || l.name}" (_id: ${l._id || l.id}) s3Key: ${l.s3Key || l.videoS3Key} videoParts: ${l.videoParts?.length}`);
      }
    }
  }

  await mongoose.disconnect();
}

checkRecentCourses().catch(console.error);
