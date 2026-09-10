const assert = require('assert');
const uploadController = require('../controllers/uploadController');

async function testUploadController() {
  console.log('🧪 Starting Direct Upload Controller Verification Tests...\n');

  // Test 1: Empty file upload validation
  console.log('Test 1: Empty File Upload Validation');
  let statusResult = 0;
  let jsonResult = null;

  const mockResEmpty = {
    status: (code) => {
      statusResult = code;
      return {
        json: (data) => {
          jsonResult = data;
          return data;
        }
      };
    }
  };

  await uploadController.uploadFiles({ files: [], file: null }, mockResEmpty);
  assert.strictEqual(statusResult, 400);
  assert.strictEqual(jsonResult.success, false);
  assert.ok(jsonResult.message.includes('No files provided'));
  console.log('  ✅ Correctly rejected empty file submissions with 400 Bad Request');

  // Test 2: Multi-file uploaded metadata mapping
  console.log('\nTest 2: Multi-File Metadata Mapping');
  const mockFiles = [
    {
      fieldname: 'files',
      originalname: 'anatomy_diagram.png',
      mimetype: 'image/png',
      size: 1048576,
      secure_url: 'https://res.cloudinary.com/vadgpisw/image/upload/v1710001111/homeopathy-media/anatomy_diagram.png',
      public_id: 'homeopathy-media/anatomy_diagram',
      resource_type: 'image',
    },
    {
      fieldname: 'files',
      originalname: 'organon_lecture.mp4',
      mimetype: 'video/mp4',
      size: 52428800,
      secure_url: 'https://res.cloudinary.com/vadgpisw/video/upload/v1710002222/homeopathy-media/organon_lecture.mp4',
      public_id: 'homeopathy-media/organon_lecture',
      resource_type: 'video',
    }
  ];

  let successStatus = 0;
  let successData = null;

  const mockResSuccess = {
    status: (code) => {
      successStatus = code;
      return {
        json: (data) => {
          successData = data;
          return data;
        }
      };
    }
  };

  await uploadController.uploadFiles({ files: mockFiles }, mockResSuccess);
  assert.strictEqual(successStatus, 200);
  assert.strictEqual(successData.success, true);
  assert.strictEqual(successData.count, 2);
  assert.strictEqual(successData.files.length, 2);
  assert.strictEqual(successData.urls.length, 2);
  assert.strictEqual(successData.files[0].public_id, 'homeopathy-media/anatomy_diagram');
  assert.strictEqual(successData.files[0].secure_url, 'https://res.cloudinary.com/vadgpisw/image/upload/v1710001111/homeopathy-media/anatomy_diagram.png');
  assert.strictEqual(successData.files[1].resource_type, 'video');
  console.log('  ✅ Correctly formatted 200 OK response with secure URLs, public IDs, and resource types');

  console.log('\n🎉 ALL UPLOAD CONTROLLER TESTS PASSED!\n');
}

testUploadController().catch((err) => {
  console.error('❌ Upload test failed:', err);
  process.exit(1);
});
