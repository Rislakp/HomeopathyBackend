const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

const targetIds = [
  '6ad4c0601d1d06b448ce3785', // BTP-2
  '6adf190d2cea39ee852c3d07', // part-6
  '6adf08c82cea39ee852c25b0', // part-6
  '6adf1afb2cea39ee852c3ed9', // part-6
  '6ae316590cb975b06f54689e'  // Part-6
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');

  for (const id of targetIds) {
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(id) }).lean();
    if (!course) {
      console.log('ERROR: Course not found for', id);
      continue;
    }
    let foundLesson = null;
    let foundModule = null;
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === id) {
          foundLesson = l;
          foundModule = m;
          break;
        }
      }
    }
    console.log('========================================================================');
    console.log('ID:', id);
    console.log('Lesson Title:', foundLesson.lessonTitle || foundLesson.title);
    console.log('Course:', course.title || course.courseName || course.name, '(' + course._id.toString() + ')');
    console.log('Module:', foundModule.title || foundModule.moduleName, '(' + foundModule._id.toString() + ')');
    console.log('meetingUrl:', foundLesson.meetingUrl);
    console.log('s3Key:', foundLesson.s3Key);
    console.log('videoS3Key:', foundLesson.videoS3Key);
    console.log('videoParts:', JSON.stringify((foundLesson.videoParts || []).map(v => ({ title: v.title, s3Key: v.s3Key, size: v.size })), null, 2));
    console.log('pdfNotes:', JSON.stringify((foundLesson.pdfNotes || []).map(p => ({ title: p.title, s3Key: p.s3Key, size: p.size })), null, 2));
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });

