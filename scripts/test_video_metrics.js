const assert = require('assert');
const mongoose = require('mongoose');
const Recording = require('../models/Recording');

async function testVideoResolutionMetrics() {
  console.log('🧪 Starting Video Resolution & Quality Metrics Verification Tests...\n');

  // Test 1: Model Schema holds width, height, bytes, format, resolution, qualityTag
  console.log('Test 1: Recording Model Resolution Specs Schema');
  const rec = new Recording({
    courseName: 'Homoeopathic Materia Medica',
    moduleName: 'Module 3: Remedy Profiles',
    lessonTitle: 'Lesson 3.1: Pulsatilla Nigricans',
    streamUrl: 'https://whitecoat.academy/live/pulsatilla',
    recordedVideoUrl: 'https://res.cloudinary.com/demo/video/upload/v1/pulsatilla.mp4',
    width: 1920,
    height: 1080,
    bytes: 15728640,
    format: 'mp4',
    resolution: '1920x1080 (1080p)',
    qualityTag: '1080p FHD',
    status: 'stopped',
  });

  const err = rec.validateSync();
  assert.strictEqual(err, undefined, 'Recording schema validation failed for resolution metrics');
  assert.strictEqual(rec.width, 1920);
  assert.strictEqual(rec.height, 1080);
  assert.strictEqual(rec.qualityTag, '1080p FHD');
  console.log('  ✅ Schema validation passed for width, height, bytes, format, resolution, and qualityTag');

  // Test 2: Resolution Quality Tag Classifier Logic
  console.log('\nTest 2: Resolution Quality Classifier Logic');
  const testCases = [
    { w: 3840, h: 2160, expectedQuality: '4K UHD' },
    { w: 2560, h: 1440, expectedQuality: '2K QHD' },
    { w: 1920, h: 1080, expectedQuality: '1080p FHD' },
    { w: 1280, h: 720,  expectedQuality: '720p HD' },
    { w: 854,  h: 480,  expectedQuality: '480p SD' },
  ];

  const calculateQualityTag = (resWidth, resHeight) => {
    if (resHeight >= 2160 || resWidth >= 3840) return '4K UHD';
    if (resHeight >= 1440 || resWidth >= 2560) return '2K QHD';
    if (resHeight >= 1080 || resWidth >= 1920) return '1080p FHD';
    if (resHeight >= 720  || resWidth >= 1280) return '720p HD';
    if (resHeight >= 480  || resWidth >= 854)  return '480p SD';
    return `${resHeight}p`;
  };

  testCases.forEach((tc) => {
    const q = calculateQualityTag(tc.w, tc.h);
    assert.strictEqual(q, tc.expectedQuality, `Expected ${tc.expectedQuality} for ${tc.w}x${tc.h}, got ${q}`);
  });
  console.log('  ✅ Resolution quality classification (4K UHD, 2K QHD, 1080p FHD, 720p HD, 480p SD) verified');

  console.log('\n🎉 ALL VIDEO METRICS VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

testVideoResolutionMetrics().catch((err) => {
  console.error('❌ Metrics test failed:', err);
  process.exit(1);
});
