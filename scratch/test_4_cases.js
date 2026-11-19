
const mongoose = require('mongoose');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const { serializeLesson } = require('../controllers/courseController');
const { getS3KeyFromUrl } = require('../services/s3Service');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  const Course = mongoose.models.Course || mongoose.model('Course');

  console.log('--- Testing getS3KeyFromUrl ---');
  console.log('google meet:', getS3KeyFromUrl('https://meet.google.com/ukm-sjrf-knf'));
  console.log('slug:', getS3KeyFromUrl('ukm-sjrf-knf'));
  console.log('s3 mp4:', getS3KeyFromUrl('https://whitecoat-media-prod.s3.amazonaws.com/videos/123.mp4'));
  console.log('media.whitecoat.academy:', getS3KeyFromUrl('https://media.whitecoat.academy/videos/123.mp4'));

  const testIds = [
    { name: 'Case 1: PART 1- ANATOMY (MP4 in meetingUrl in DB)', id: '6af544194f9afd8b33e4ebdd' },
    { name: 'Case 2: PART 2 (Live class with ukm-sjrf-knf)', id: '6aeddf6d22378ff1db3fea3d' },
    { name: 'Case 3: AIAPGET part-6 (Video + PDF)', id: '6adf190d2cea39ee852c3d07' },
    { name: 'Case 4: MM WEEK 1 (PDF only)', id: '6ac5de3ce8a3829089c9edc1' }
  ];

  for (const t of testIds) {
    console.log('\n======================================================');
    console.log(t.name);
    console.log('Lesson ID:', t.id);
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(t.id) }).lean();
    if (!course) {
      console.log('Course not found for lesson', t.id);
      continue;
    }
    let foundLesson = null;
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === t.id) {
          foundLesson = l;
          break;
        }
      }
    }
    if (!foundLesson) {
      console.log('Lesson not found');
      continue;
    }
    console.log('RAW DB meetingUrl:', foundLesson.meetingUrl ? foundLesson.meetingUrl.slice(0, 50) + '...' : '(empty)');
    console.log('RAW DB s3Key:', foundLesson.s3Key);
    console.log('RAW DB videoParts count:', (foundLesson.videoParts || []).length);
    console.log('RAW DB pdfNotes count:', (foundLesson.pdfNotes || []).length);

    const serialized = await serializeLesson(foundLesson, { user: { role: 'admin' } });
    console.log('SERIALIZED meetingUrl:', serialized.meetingUrl || '(empty)');
    console.log('SERIALIZED videoUrl:', serialized.videoUrl ? (serialized.videoUrl.slice(0, 60) + '...') : '(empty)');
    console.log('SERIALIZED videoParts count:', serialized.videoParts.length);
    if (serialized.videoParts.length > 0) {
      console.log('SERIALIZED videoParts:', serialized.videoParts.map(v => ({ title: v.title, s3Key: v.s3Key, storage: v.storageProvider })));
    }
    console.log('SERIALIZED pdfNotes count:', serialized.pdfNotes.length);
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
