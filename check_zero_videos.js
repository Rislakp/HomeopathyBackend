const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).toArray();

  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        if (!l.videoParts || l.videoParts.length === 0) {
          console.log(`ZERO VIDEO PARTS: Course="${c.title || c.courseTitle}", Module="${m.title || m.moduleName}", Lesson="${l.lessonTitle || l.title}" [id: ${l._id}] (${l.lessonType})`);
          console.log(`  s3Key: "${l.s3Key}" | videoS3Key: "${l.videoS3Key}" | meetingUrl: "${l.meetingUrl}"`);
          console.log(`  pdfNotes: ${(l.pdfNotes||[]).length}, assignments: ${(l.assignments||[]).length}, attachments: ${(l.attachments||[]).length}`);
        }
      }
    }
  }

  await mongoose.disconnect();
}
run();

