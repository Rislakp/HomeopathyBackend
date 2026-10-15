const mongoose = require('mongoose');
require('dotenv').config();

async function inspectCombo() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  const course = await Course.findOne({ courseId: 'CRS-000070' });
  if (!course) {
    console.log('Course CRS-000070 not found!');
    return;
  }
  console.log('Course ID:', course.courseId, '| Title:', course.courseTitle, '| _id:', course._id);
  const modules = course.modules || [];
  console.log('Total modules:', modules.length);
  for (let mIdx = 0; mIdx < modules.length; mIdx++) {
    const m = modules[mIdx];
    console.log(`Module [${mIdx}]: ${m.moduleName || m.title}`);
    for (let lIdx = 0; lIdx < (m.lessons || []).length; lIdx++) {
      const l = m.lessons[lIdx];
      console.log(`  Lesson [${lIdx}]: ${l.lessonTitle || l.title}`);
      console.log('    videoUrl:', l.videoUrl, '| videoS3Key:', l.videoS3Key, '| s3Key:', l.s3Key);
      console.log('    videoParts:', JSON.stringify(l.videoParts, null, 2));
      console.log('    pdfNotes:', JSON.stringify(l.pdfNotes, null, 2));
      console.log('    attachments:', JSON.stringify(l.attachments, null, 2));
      console.log('    taskWorksheets:', JSON.stringify(l.taskWorksheets, null, 2));
    }
  }
  await mongoose.disconnect();
}
inspectCombo().catch(console.error);
