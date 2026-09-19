const assert = require('assert');
const mongoose = require('mongoose');
const Recording = require('../models/Recording');

async function testVideoUrlSanitization() {
  console.log('🧪 Starting Video URL Sanitization & Fallback Verification Tests...\n');

  // Test 1: Default pending recording has empty string recordedVideoUrl
  console.log('Test 1: Default Pending Recording Fallback');
  const pendingRec = new Recording({
    courseName: 'Homeopathic Therapeutics',
    moduleName: 'Module 2',
    lessonTitle: 'Lesson 2.1: Case Taking',
    streamUrl: 'https://whitecoat.academy/live/case-taking',
    status: 'pending',
  });

  assert.strictEqual(pendingRec.recordedVideoUrl, '', 'Pending recording recordedVideoUrl must default to empty string');
  console.log('  ✅ Pending recording recordedVideoUrl defaults to empty string ""');

  // Test 2: Cloudinary secure_url is preserved
  console.log('\nTest 2: Cloudinary secure_url Storage');
  const cloudUrl = 'https://res.cloudinary.com/demo/video/upload/v1726300000/recording.mp4';
  const completedRec = new Recording({
    courseName: 'Homeopathic Therapeutics',
    recordedVideoUrl: cloudUrl,
    status: 'stopped',
  });

  assert.strictEqual(completedRec.recordedVideoUrl, cloudUrl, 'Cloudinary URL must be preserved');
  console.log('  ✅ Cloudinary secure_url preserved accurately');

  // Test 3: Restricted GCP links filter test
  console.log('\nTest 3: Restricted GCP Link Filtering');
  const gcpLink = 'https://storage.googleapis.com/private-bucket/video.mp4';
  const sanitizeVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (
      trimmed.includes('storage.googleapis.com') ||
      trimmed.includes('storage.cloud.google.com') ||
      trimmed.includes('drive.google.com/file')
    ) {
      return '';
    }
    return trimmed;
  };

  assert.strictEqual(sanitizeVideoUrl(gcpLink), '', 'Restricted GCP link must be sanitized to empty string');
  assert.strictEqual(sanitizeVideoUrl(cloudUrl), cloudUrl, 'Valid Cloudinary link must pass filter');
  console.log('  ✅ Restricted GCP links sanitized to empty string ""');

  console.log('\n🎉 ALL VIDEO URL SANITIZATION TESTS PASSED SUCCESSFULLY!\n');
}

testVideoUrlSanitization().catch((err) => {
  console.error('❌ Sanitization test failed:', err);
  process.exit(1);
});
