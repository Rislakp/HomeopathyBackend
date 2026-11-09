const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = require('../models/Course');

async function inspectPdfs() {
  await mongoose.connect(process.env.MONGODB_URI);
  const courses = await Course.find({}).lean();
  console.log(`Found ${courses.length} courses`);

  for (const c of courses) {
    console.log(`\n=== Course: ${c.courseTitle || c.title} (ID: ${c.courseId}, _id: ${c._id}) ===`);
    let pdfCount = 0;
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        for (const cat of ['pdfNotes', 'assignments', 'attachments']) {
          for (const item of l[cat] || []) {
            pdfCount++;
            console.log(`Lesson "${l.lessonTitle}" -> [${cat}] "${item.title || item.fileName}":`, {
              title: item.title,
              fileName: item.fileName,
              url: item.url ? item.url.substring(0, 60) + '...' : '(empty)',
              storageProvider: item.storageProvider,
              s3Key: item.s3Key,
              backupS3Key: item.backupS3Key,
              resourceType: item.resourceType,
              mimetype: item.mimetype,
            });
          }
        }
      }
    }
    console.log(`Total PDF/doc items in course: ${pdfCount}`);
  }
  await mongoose.disconnect();
}
inspectPdfs();
