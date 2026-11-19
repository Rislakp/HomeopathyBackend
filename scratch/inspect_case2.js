
const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId('6aeddf6d22378ff1db3fea3d') }).lean();
  for (const m of course.modules || []) {
    for (const l of m.lessons || []) {
      if (l._id.toString() === '6aeddf6d22378ff1db3fea3d') {
        console.log('Case 2 lesson:');
        console.log('type:', l.type, 'lessonType:', l.lessonType);
        console.log('videoParts:', JSON.stringify(l.videoParts, null, 2));
        console.log('videoUrl:', l.videoUrl);
        console.log('meetingUrl:', l.meetingUrl);
        console.log('s3Key:', l.s3Key);
      }
    }
  }
  await mongoose.disconnect();
}
run();
