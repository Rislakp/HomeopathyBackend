const mongoose = require('mongoose');
const assert = require('assert');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const { serializeLesson } = require('../controllers/courseController');
const { getS3KeyFromUrl } = require('../services/s3Service');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');
  const Course = mongoose.models.Course || mongoose.model('Course');

  console.log('=================================================================');
  console.log('BACKEND VERIFICATION AUDIT');
  console.log('=================================================================');

  async function findLesson(id) {
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(id) }).lean();
    if (!course) throw new Error('Course not found for lesson ' + id);
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === id) return l;
      }
    }
    throw new Error('Lesson not found ' + id);
  }

  // 1. Case 1: PART 1- ANATOMY (ID 6af544194f9afd8b33e4ebdd)
  console.log('\n[TEST 1] Case 1: PART 1- ANATOMY (MP4 in meetingUrl in DB)');
  const l1 = await findLesson('6af544194f9afd8b33e4ebdd');
  const s1 = await serializeLesson(l1, { user: { role: 'admin' } });
  assert.strictEqual(s1.meetingUrl, '', 'meetingUrl must be empty (MP4 must not be in meetingUrl)');
  assert.ok(s1.videoUrl && s1.videoUrl.includes('.mp4'), 'videoUrl must be genuine MP4 URL');
  assert.strictEqual(s1.videoParts.length, 1, 'videoParts must have 1 genuine video');
  assert.ok(s1.videoParts[0].s3Key.includes('.mp4'), 'videoPart must have valid mp4 s3Key');
  console.log('  PASSED: meetingUrl="", videoUrl has MP4, videoParts count=1');

  // 2. Case 2: PART 2 (ID 6aeddf6d22378ff1db3fea3d)
  console.log('\n[TEST 2] Case 2: PART 2 (Live class with Google Meet & slug s3Key in DB)');
  const l2 = await findLesson('6aeddf6d22378ff1db3fea3d');
  const s2 = await serializeLesson(l2, { user: { role: 'admin' } });
  assert.strictEqual(s2.meetingUrl, 'https://meet.google.com/ukm-sjrf-knf', 'meetingUrl must be preserved');
  assert.strictEqual(s2.videoUrl, '', 'videoUrl must be empty');
  assert.strictEqual(s2.videoParts.length, 0, 'videoParts must be 0 (no ghost video)');
  assert.strictEqual(getS3KeyFromUrl('https://meet.google.com/ukm-sjrf-knf'), null, 'getS3KeyFromUrl must return null for meet URL');
  assert.strictEqual(getS3KeyFromUrl('ukm-sjrf-knf'), null, 'getS3KeyFromUrl must return null for meeting slug');
  console.log('  PASSED: meetingUrl preserved, videoUrl="", videoParts=0, S3 key extraction rejected');

  // 3. Case 3: AIAPGET part-6 (ID 6adf190d2cea39ee852c3d07)
  console.log('\n[TEST 3] Case 3: AIAPGET part-6 (Video + PDF, with PDF in meetingUrl in DB)');
  const l3 = await findLesson('6adf190d2cea39ee852c3d07');
  const s3 = await serializeLesson(l3, { user: { role: 'admin' } });
  assert.strictEqual(s3.meetingUrl, '', 'meetingUrl must be empty (PDF must not appear in meetingUrl)');
  assert.ok(s3.videoUrl && s3.videoUrl.includes('.mp4'), 'videoUrl must remain genuine MP4');
  assert.strictEqual(s3.videoParts.length, 1, 'videoParts must have 1 genuine video');
  assert.strictEqual(s3.pdfNotes.length, 1, 'pdfNotes must remain 1 genuine PDF');
  console.log('  PASSED: meetingUrl="", videoUrl has MP4, videoParts=1, pdfNotes=1');

  // 4. Case 4: MM WEEK 1 (ID 6ac5de3ce8a3829089c9edc1)
  console.log('\n[TEST 4] Case 4: MM WEEK 1 (PDF only lesson in DB)');
  const l4 = await findLesson('6ac5de3ce8a3829089c9edc1');
  const s4 = await serializeLesson(l4, { user: { role: 'admin' } });
  assert.strictEqual(s4.meetingUrl, '', 'meetingUrl must be empty');
  assert.strictEqual(s4.videoUrl, '', 'videoUrl must be empty');
  assert.strictEqual(s4.videoParts.length, 0, 'videoParts must be 0 (no ghost video for PDF lesson)');
  console.log('  PASSED: meetingUrl="", videoUrl="", videoParts=0');

  // 5. Case 5: Valid Google Meet Lesson Verification
  console.log('\n[TEST 5] Case 5: Valid Google Meet Lesson');
  const mockMeetLesson = {
    _id: new mongoose.Types.ObjectId(),
    lessonTitle: 'Live Mentorship Session',
    lessonType: 'Live Class',
    meetingUrl: 'https://meet.google.com/xyz-abcd-efg',
    videoParts: [],
    pdfNotes: [],
  };
  const s5 = await serializeLesson(mockMeetLesson, { user: { role: 'admin' } });
  assert.strictEqual(s5.meetingUrl, 'https://meet.google.com/xyz-abcd-efg', 'meetingUrl must be preserved');
  assert.strictEqual(s5.videoParts.length, 0, 'videoParts must be 0');
  assert.strictEqual(s5.videoUrl, '', 'videoUrl must be empty');
  console.log('  PASSED: Live Google Meet lesson correctly serializes meetingUrl with 0 video parts');

  // 6. Case 6: Multiple Genuine Video Parts Verification
  console.log('\n[TEST 6] Case 6: Lesson with Multiple Genuine Video Parts');
  const mockMultiVideoLesson = {
    _id: new mongoose.Types.ObjectId(),
    lessonTitle: 'Complex Anatomy Lecture',
    lessonType: 'Recorded Video',
    meetingUrl: '',
    videoParts: [
      {
        title: 'Part 1: Introduction',
        s3Key: 'videos/multi-part-1.mp4',
        secure_url: 'https://media.whitecoat.academy/videos/multi-part-1.mp4',
        storageProvider: 's3',
        resourceType: 'video'
      },
      {
        title: 'Part 2: Deep Dive',
        s3Key: 'videos/multi-part-2.mp4',
        secure_url: 'https://media.whitecoat.academy/videos/multi-part-2.mp4',
        storageProvider: 's3',
        resourceType: 'video'
      },
      {
        title: 'Part 3: Clinical Correlation',
        s3Key: 'videos/multi-part-3.mp4',
        secure_url: 'https://media.whitecoat.academy/videos/multi-part-3.mp4',
        storageProvider: 's3',
        resourceType: 'video'
      }
    ],
    pdfNotes: []
  };
  const s6 = await serializeLesson(mockMultiVideoLesson, { user: { role: 'admin' } });
  assert.strictEqual(s6.meetingUrl, '', 'meetingUrl must be empty');
  assert.strictEqual(s6.videoParts.length, 3, 'All 3 video parts must be preserved');
  assert.strictEqual(s6.videoParts[0].title, 'Part 1: Introduction');
  assert.strictEqual(s6.videoParts[1].title, 'Part 2: Deep Dive');
  assert.strictEqual(s6.videoParts[2].title, 'Part 3: Clinical Correlation');
  assert.strictEqual(s6.videoParts[0].s3Key, 'videos/multi-part-1.mp4');
  assert.strictEqual(s6.videoParts[1].s3Key, 'videos/multi-part-2.mp4');
  assert.strictEqual(s6.videoParts[2].s3Key, 'videos/multi-part-3.mp4');
  console.log('  PASSED: Multiple video parts preserved perfectly in order with titles and S3 keys');

  console.log('\n=================================================================');
  console.log('ALL 6 BACKEND TESTS PASSED SUCCESSFULLY (Exit Code: 0)');
  console.log('=================================================================');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\nTEST FAILURE:', err);
  process.exit(1);
});

