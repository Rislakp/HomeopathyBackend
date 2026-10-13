const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function searchCourses() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // Print all courses and their modules and lessons completely
  const courses = await db.collection('courses').find({}).toArray();
  console.log(`Total courses: ${courses.length}`);
  for (const c of courses) {
    console.log(`\n======================================================`);
    console.log(`COURSE: ${c.courseTitle || c.title} (ID: ${c._id})`);
    for (const m of c.modules || []) {
      console.log(`  MODULE: ${m.moduleName} (ID: ${m._id})`);
      for (const l of m.lessons || []) {
        console.log(`    LESSON: ${l.lessonTitle} (ID: ${l._id})`);
        console.log(`      videoUrl: ${l.videoUrl}`);
        console.log(`      pdfUrl: ${l.pdfUrl}`);
        if (l.pdfNotes && l.pdfNotes.length > 0) {
          console.log(`      pdfNotes:`, JSON.stringify(l.pdfNotes, null, 2));
        }
        if (l.videoParts && l.videoParts.length > 0) {
          console.log(`      videoParts:`, JSON.stringify(l.videoParts, null, 2));
        }
        if (l.attachments && l.attachments.length > 0) {
          console.log(`      attachments:`, JSON.stringify(l.attachments, null, 2));
        }
      }
    }
  }

  // Also check all exams questions for any images, pdfs, etc.
  console.log(`\n======================================================`);
  console.log(`EXAMS DETAIL:`);
  const exams = await db.collection('exams').find({}).toArray();
  for (const ex of exams) {
    const qWithImg = (ex.questions || []).filter(q => q.imageUrl || q.image || q.questionImage || q.imgUrl);
    if (qWithImg.length > 0) {
      console.log(`\nExam: "${ex.examTitle || ex.title}" (${ex._id}) - Questions with image: ${qWithImg.length}`);
      for (const q of qWithImg) {
        console.log(`  Q[${q._id}]: ${q.questionText}`);
        console.log(`    imageUrl: ${q.imageUrl}`);
        console.log(`    image: ${q.image}`);
        console.log(`    questionImage: ${q.questionImage}`);
      }
    }
  }

  await mongoose.disconnect();
}

searchCourses().catch(err => {
  console.error(err);
  process.exit(1);
});
