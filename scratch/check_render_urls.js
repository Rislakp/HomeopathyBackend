const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function checkRenderUrls() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  
  const courses = await Course.find({}).lean();
  let found = 0;
  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        for (const [key, items] of Object.entries({ pdfNotes: l.pdfNotes, attachments: l.attachments, videoParts: l.videoParts })) {
          for (const item of (items || [])) {
            const u = item.url || item.secure_url || '';
            if (u.includes('homeopathybackend-1.onrender.com') || u.includes('/uploads/')) {
              found++;
              console.log(`Course: "${c.courseTitle}" | Module: "${m.moduleTitle}" | Lesson: "${l.lessonTitle}" | Key: ${key} | Title: "${item.title || item.fileName}" | URL: "${u}"`);
            }
          }
        }
      }
    }
  }
  console.log(`Total legacy/uploads URLs found: ${found}`);
  await mongoose.disconnect();
}
checkRenderUrls();
