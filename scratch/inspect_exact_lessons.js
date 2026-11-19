
const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  
  const targetIds = ['6ad4c0601d1d06b448ce3785', '6adf190d2cea39ee852c3d07'];

  for (const targetId of targetIds) {
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(targetId) }).lean();
    if (!course) {
      console.log('Course not found for', targetId);
      continue;
    }
    let targetLesson = null;
    let targetModule = null;
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === targetId) {
          targetLesson = l;
          targetModule = m;
          break;
        }
      }
    }

    console.log('========================================================================');
    console.log('TARGET LESSON INSPECTION');
    console.log('Lesson ID:', targetId);
    console.log('Course ID:', course._id.toString(), '| Course Name:', course.courseName || course.title || course.name);
    console.log('Module ID:', targetModule._id.toString(), '| Module Name:', targetModule.moduleName || targetModule.title || targetModule.name);
    console.log('Lesson Title:', targetLesson.lessonTitle || targetLesson.title || targetLesson.name);
    console.log('Lesson Type:', targetLesson.lessonType || targetLesson.type);
    console.log('Status:', targetLesson.status);
    console.log('\n--- 1. meetingUrl ---');
    console.log(targetLesson.meetingUrl);
    console.log('\n--- 2. pdfNotes and PDF fields ---');
    console.log('pdfNotes:', JSON.stringify(targetLesson.pdfNotes, null, 2));
    console.log('pdfFiles:', JSON.stringify(targetLesson.pdfFiles, null, 2));
    console.log('assignments:', JSON.stringify(targetLesson.assignments, null, 2));
    console.log('attachments:', JSON.stringify(targetLesson.attachments, null, 2));
    console.log('\n--- 3. videoUrl ---');
    console.log(targetLesson.videoUrl);
    console.log('\n--- 4. mediaUrlOrPath ---');
    console.log(targetLesson.mediaUrlOrPath);
    console.log('\n--- 5. s3Key ---');
    console.log(targetLesson.s3Key);
    console.log('\n--- 6. videoS3Key ---');
    console.log(targetLesson.videoS3Key);
    console.log('\n--- 7. videoParts ---');
    console.log(JSON.stringify(targetLesson.videoParts, null, 2));
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
