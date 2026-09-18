const assert = require('assert');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_12345';

const cloudinaryConfig = require('../config/cloudinary');
const uploadController = require('../controllers/uploadController');
const { processUploadsToCloudinary } = require('../middleware/upload');
const examController = require('../controllers/examController');
const Exam = require('../models/Exam');

async function runTests() {
  console.log('====================================================');
  console.log('STARTING BACKEND IMAGE UPLOAD PIPELINE VERIFICATION');
  console.log('====================================================');

  const configured = cloudinaryConfig.isCloudinaryConfigured();
  console.log(`Cloudinary Configured in env: ${configured}`);

  // Valid 1x1 transparent PNG base64 string
  const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const dummyPngBuffer = Buffer.from(validPngBase64, 'base64');

  console.log('\n--- TEST 1: Direct Memory Buffer Upload to Cloudinary via Middleware & Controller ---');
  
  const mockReq = {
    body: { folder: 'grand_mock_questions' },
    file: {
      fieldname: 'file',
      originalname: 'question_1_test.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: dummyPngBuffer,
      size: dummyPngBuffer.length
    },
    get: (header) => (header === 'host' ? 'homeopathybackend-1.onrender.com' : ''),
    protocol: 'https'
  };

  let statusCode = null;
  let responseData = null;

  const mockRes = {
    status: (code) => {
      statusCode = code;
      return mockRes;
    },
    json: (data) => {
      responseData = data;
      return mockRes;
    }
  };

  // Run processUploadsToCloudinary middleware first
  await processUploadsToCloudinary(mockReq, mockRes, () => {});

  // Call uploadQuestionImage controller
  await uploadController.uploadQuestionImage(mockReq, mockRes);

  console.log('Response Status:', statusCode);
  console.log('Response Body:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 200, 'Expected HTTP 200 from uploadQuestionImage');
  assert.strictEqual(responseData.success, true, 'Expected success: true');
  assert.ok(responseData.secure_url, 'Expected secure_url to be present at root level');
  assert.ok(responseData.url, 'Expected url to be present at root level');
  assert.ok(responseData.public_id, 'Expected public_id to be present at root level');
  assert.strictEqual(responseData.resource_type, 'image', 'Expected resource_type to be image');

  const uploadedImageUrl = responseData.secure_url;
  console.log('✅ TEST 1 PASSED: Uploaded image URL =', uploadedImageUrl);

  console.log('\n--- TEST 2: General uploadFiles Controller Response Layout ---');
  statusCode = null;
  responseData = null;

  const mockReq2 = {
    body: { folder: 'grand_mock_questions' },
    file: {
      fieldname: 'file',
      originalname: 'question_2_test.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: dummyPngBuffer,
      size: dummyPngBuffer.length
    },
    get: (header) => (header === 'host' ? 'homeopathybackend-1.onrender.com' : ''),
    protocol: 'https'
  };

  await processUploadsToCloudinary(mockReq2, mockRes, () => {});
  await uploadController.uploadFiles(mockReq2, mockRes);

  console.log('Response Status:', statusCode);
  console.log('Response Body:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 200, 'Expected HTTP 200 from uploadFiles');
  assert.strictEqual(responseData.success, true, 'Expected success: true');
  assert.ok(responseData.secure_url, 'Expected secure_url to be present at root level');
  assert.ok(responseData.url, 'Expected url to be present at root level');
  assert.ok(responseData.public_id, 'Expected public_id to be present at root level');
  console.log('✅ TEST 2 PASSED: Root secure_url & url present');

  console.log('\n--- TEST 3: POST /api/exams/grand-mock with imageUrl Persistence ---');
  const mockReqCreate = {
    body: {
      title: 'Test Exam with Cloudinary Image',
      testType: 'grand_mock',
      marksPerQuestion: 2,
      durationMinutes: 30,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'Identify the specimen shown in the image below:',
          options: {
            A: 'Option A',
            B: 'Option B',
            C: 'Option C',
            D: 'Option D'
          },
          correctOption: 'A',
          imageUrl: uploadedImageUrl
        }
      ]
    }
  };

  statusCode = null;
  responseData = null;

  if (mongoose.connection.readyState === 0) {
    const originalCreate = Exam.create;
    Exam.create = async (doc) => ({ ...doc, _id: new mongoose.Types.ObjectId() });
    await examController.createGrandMockExam(mockReqCreate, mockRes);
    Exam.create = originalCreate;
  } else {
    await examController.createGrandMockExam(mockReqCreate, mockRes);
  }

  console.log('Create Exam Response Status:', statusCode);
  console.log('Create Exam Response Body:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 201, 'Expected HTTP 201 for exam creation');
  assert.strictEqual(responseData.success, true, 'Expected success: true');
  assert.ok(responseData.exam, 'Expected response to contain exam');
  assert.ok(Array.isArray(responseData.exam.questions), 'Expected questions array');
  assert.strictEqual(
    responseData.exam.questions[0].imageUrl,
    uploadedImageUrl,
    'Expected question.imageUrl to match the uploaded Cloudinary URL'
  );

  console.log('✅ TEST 3 PASSED: Question imageUrl preserved perfectly!');
  console.log('\n====================================================');
  console.log('ALL IMAGE UPLOAD PIPELINE TESTS PASSED SUCCESSFULLY');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
