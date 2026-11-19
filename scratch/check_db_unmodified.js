const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  const ids = ['6af544194f9afd8b33e4ebdd', '6aeddf6d22378ff1db3fea3d', '6adf190d2cea39ee852c3d07', '6ac5de3ce8a3829089c9edc1'];
  for (const id of ids) {
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(id) }).lean();
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === id) {
          console.log('[VERIFIED UNTOUCHED] Lesson ' + id + ': updatedAt=' + l.updatedAt);
        }
      }
    }
  }
  await mongoose.disconnect();
}
run();
