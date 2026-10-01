const assert = require('assert');
const uploadController = require('../controllers/uploadController');

async function testGetMediaEndpoint() {
  console.log('🧪 Starting Cloudinary Media Listing Verification Tests...\n');

  // Test 1: Fetch stored assets via getMediaAssets controller
  console.log('Test 1: Invoking getMediaAssets Controller');
  let statusCode = 0;
  let responseBody = null;

  const mockReq = {
    query: {
      folder: 'all',
      max_results: 10,
    }
  };

  const mockRes = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseBody = data;
          return data;
        }
      };
    }
  };

  await uploadController.getMediaAssets(mockReq, mockRes);

  assert.strictEqual(statusCode, 200, `Expected HTTP 200, got ${statusCode}`);
  assert.strictEqual(responseBody.success, true);
  assert.ok(Array.isArray(responseBody.resources), 'resources should be an array');
  assert.ok(typeof responseBody.total_bytes === 'number', 'total_bytes should be a number');
  assert.ok(typeof responseBody.total_size_formatted === 'string', 'total_size_formatted should be a string');

  if (responseBody.resources.length > 0) {
    const first = responseBody.resources[0];
    assert.ok(first.public_id, 'Resource must have public_id');
    assert.ok(first.secure_url, 'Resource must have secure_url');
    assert.ok(first.resource_type, 'Resource must have resource_type');
    assert.ok(first.size_formatted, 'Resource must have size_formatted');
    console.log(`  ✅ Successfully retrieved ${responseBody.resources.length} stored assets from Cloudinary.`);
    console.log(`  Sample asset: [${first.resource_type.toUpperCase()}] ${first.public_id} (${first.size_formatted}) -> ${first.secure_url}`);
  } else {
    console.log('  ✅ getMediaAssets executed cleanly with 0 items.');
  }

  console.log('\n🎉 ALL CLOUDINARY MEDIA LISTING TESTS PASSED!\n');
}

testGetMediaEndpoint().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
