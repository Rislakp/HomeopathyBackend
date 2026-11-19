
const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  
  const courses = await Course.find({}).lean();
  console.log('Total courses scanned:', courses.length);

  const affectedLessons = [];

  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const meetingUrl = (l.meetingUrl || l.liveLink || l.meetingLink || '').trim();
        const hasPdfInMeeting = meetingUrl.toLowerCase().includes('.pdf') || meetingUrl.toLowerCase().includes('/pdfs/');
        
        // Also check if meetingUrl matches any pdfNotes url or s3Key
        const pdfUrls = (l.pdfNotes || []).map(p => (p.url || p.secure_url || p.s3Key || '').trim());
        const pdfFilesUrls = (l.pdfFiles || []).map(p => (p.url || p.secure_url || p.s3Key || '').trim());
        const allDocUrls = [...pdfUrls, ...pdfFilesUrls].filter(Boolean);

        const matchesDoc = allDocUrls.some(u => u && meetingUrl && (u === meetingUrl || meetingUrl.includes(u) || u.includes(meetingUrl)));

        if (hasPdfInMeeting || matchesDoc) {
          affectedLessons.push({
            courseId: c._id.toString(),
            courseTitle: c.title,
            moduleId: m._id.toString(),
            moduleTitle: m.title,
            lessonId: l._id.toString(),
            lessonTitle: l.lessonTitle || l.title,
            meetingUrl: meetingUrl,
            allDocUrls: allDocUrls,
            matchesDoc: matchesDoc,
            hasPdfInMeeting: hasPdfInMeeting,
            rawLesson: l
          });
        }
      }
    }
  }

  console.log('Affected lessons with PDF in meetingUrl or matching doc:', affectedLessons.length);
  for (const item of affectedLessons) {
    console.log('----------------------------------------------------');
    console.log('Course:', item.courseTitle, '(' + item.courseId + ')');
    console.log('Module:', item.moduleTitle, '(' + item.moduleId + ')');
    console.log('Lesson:', item.lessonTitle, '(' + item.lessonId + ')');
    console.log('meetingUrl:', item.meetingUrl);
    console.log('allDocUrls:', item.allDocUrls);
    console.log('matchesDoc exactly?', item.matchesDoc);
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
