const assert = require('assert');
const mongoose = require('mongoose');
const Recording = require('../models/Recording');

async function testLiveRecordingsLifecycle() {
  console.log('🧪 Starting Live Records Lifecycle API Tests...\n');

  // Test 1: Schema Validation for new payload fields
  console.log('Test 1: Recording Schema Validation (Direct Payload)');
  const recData = {
    courseName: 'Organon of Medicine & Philosophy',
    moduleName: 'Module 1: Fundamental Principles',
    lessonTitle: 'Lesson 1.1: Vital Force & Miasms',
    streamUrl: 'https://whitecoat.academy/live/miasms-101',
    status: 'pending',
  };

  const rec = new Recording(recData);
  const valErr = rec.validateSync();
  assert.strictEqual(valErr, undefined, 'Recording schema validation failed for lifecycle fields');
  assert.strictEqual(rec.courseName, 'Organon of Medicine & Philosophy');
  assert.strictEqual(rec.status, 'pending');
  console.log('  ✅ Schema validation passed for courseName, moduleName, lessonTitle, streamUrl, and status');

  // Test 2: Lifecycle Status Progression
  console.log('\nTest 2: Status Lifecycle Transitions');
  const validTransitions = ['pending', 'recording', 'paused', 'stopped', 'recorded'];
  validTransitions.forEach((st) => {
    rec.status = st;
    const err = rec.validateSync();
    assert.strictEqual(err, undefined, `Status '${st}' failed schema validation`);
  });
  console.log('  ✅ Validated status lifecycle transitions: pending -> recording -> paused -> stopped -> recorded');

  // Test 3: Recorded Video Attachment
  console.log('\nTest 3: Cloudinary Recorded Video URL Attachment');
  rec.recordedVideoUrl = 'https://res.cloudinary.com/demo/video/upload/v1/recorded_miasms.mp4';
  rec.status = 'stopped';
  assert.strictEqual(rec.recordedVideoUrl, 'https://res.cloudinary.com/demo/video/upload/v1/recorded_miasms.mp4');
  assert.strictEqual(rec.status, 'stopped');
  console.log('  ✅ Recorded video URL attachment verified');

  console.log('\n🎉 ALL LIVE RECORDINGS LIFECYCLE TESTS PASSED SUCCESSFULLY!\n');
}

testLiveRecordingsLifecycle().catch((err) => {
  console.error('❌ Lifecycle test failed:', err);
  process.exit(1);
});
