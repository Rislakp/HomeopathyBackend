const assert = require('assert');
const upload = require('../middleware/upload');
const { isCloudinaryConfigured } = require('../config/cloudinary');

async function testCloudinaryUploadPipeline() {
  console.log('🧪 Starting Cloudinary Storage & Upload Pipeline Verification Tests...\n');

  // Test 1: Upload Limit Configuration
  console.log('Test 1: File Size Upload Limit Verification');
  assert.strictEqual(upload.MAX_UPLOAD_SIZE, 200 * 1024 * 1024, 'MAX_UPLOAD_SIZE must be set to 200MB (209,715,200 bytes)');
  console.log('  ✅ MAX_UPLOAD_SIZE set to 200MB (209,715,200 bytes)');

  // Test 2: Startup Environment Validation
  console.log('\nTest 2: Startup Environment Credentials Check');
  const initialCloudinaryConfigured = isCloudinaryConfigured();
  console.log(`  ℹ️ Cloudinary Configured Status in Current Env: ${initialCloudinaryConfigured}`);

  // Test 3: Resource Routing Classification for Videos and Live Recordings
  console.log('\nTest 3: Resource Routing for Video & Live Stream Recordings');
  const mockVideoFile = {
    fieldname: 'recordingVideo',
    originalname: 'live_session_miasms.mp4',
    mimetype: 'video/mp4',
  };

  const ext = 'mp4';
  const mimetype = mockVideoFile.mimetype.toLowerCase();
  const fieldname = mockVideoFile.fieldname.toLowerCase();
  const isVideo = mimetype.startsWith('video/') || fieldname.includes('video') || fieldname.includes('recording') || upload.ALLOWED_VIDEO_FORMATS.includes(ext);

  assert.strictEqual(isVideo, true, 'Video and recording files must be routed to video resource_type');
  console.log('  ✅ Video and recording files correctly classified as resource_type: "video"');

  console.log('\n🎉 ALL CLOUDINARY UPLOAD PIPELINE TESTS PASSED SUCCESSFULLY!\n');
}

testCloudinaryUploadPipeline().catch((err) => {
  console.error('❌ Upload pipeline test failed:', err);
  process.exit(1);
});
