const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');
const upload = require('../middleware/upload');
const { isCloudinaryConfigured } = require('../config/cloudinary');

async function runVideoUploadDiagnostic() {
  console.log('🧪 Starting Video Upload Diagnostic & Flow Verification...\n');

  assert.strictEqual(isCloudinaryConfigured(), true, 'Cloudinary should be configured with vadgpisw');

  // Load a small sample video buffer from demo.mp4
  const potentialPaths = [
    path.join(__dirname, '..', '..', 'admin_frontend', 'assets', 'video', 'demo.mp4'),
    path.join(__dirname, '..', 'assets', 'video', 'demo.mp4'),
  ];
  let videoBuffer = null;
  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      videoBuffer = fs.readFileSync(p);
      break;
    }
  }
  if (!videoBuffer) {
    throw new Error('demo.mp4 not found in assets');
  }

  // Test 1: Fake URL Rejection for Recorded Video Lessons
  console.log('Test 1: Rejecting Fake & Placeholder Video URLs');

  const mockCourse = new Course({
    courseTitle: 'Video Diagnostic Course',
    modules: [{
      _id: new mongoose.Types.ObjectId(),
      moduleName: 'Module 1',
      lessons: []
    }]
  });
  mockCourse.save = async () => true;

  const moduleId = mockCourse.modules[0]._id.toString();

  // Mock course lookup helper
  const originalFindOne = Course.findOne;
  Course.findOne = () => ({
    exec: async () => mockCourse,
    then: (resolve) => Promise.resolve(mockCourse).then(resolve)
  });

  let statusCaptured = null;
  let jsonResponse = null;
  const mockRes = {
    status: (code) => {
      statusCaptured = code;
      return {
        json: (data) => {
          jsonResponse = data;
          return data;
        }
      };
    }
  };

  // Attempt to submit a fake/bare filename without file upload
  const fakeReq = {
    params: { courseId: mockCourse._id.toString(), moduleId },
    body: {
      lessonTitle: 'Fake Video Lesson',
      lessonType: 'Recorded Video',
      videoUrl: 'bare_unuploaded_file.mp4'
    },
    file: null,
    files: []
  };

  await courseController.addLesson(fakeReq, mockRes);
  assert.strictEqual(statusCaptured, 400, 'Should reject bare unuploaded filename for Recorded Video');
  assert.strictEqual(jsonResponse.success, false);
  console.log('  ✔ Correctly rejected bare unuploaded filename (Status 400):', jsonResponse.message);

  // Test 2: Process video through processUploadsToCloudinary middleware
  console.log('\nTest 2: Video Processing via processUploadsToCloudinary');
  
  const mockFile = {
    fieldname: 'videoFile',
    originalname: 'test_demo_lecture.mp4',
    mimetype: 'video/mp4',
    buffer: videoBuffer,
    size: videoBuffer.length
  };

  const uploadReq = {
    file: null,
    files: [mockFile]
  };

  let nextCalled = false;
  const mockNext = () => { nextCalled = true; };

  console.log('  Executing processUploadsToCloudinary middleware:');
  await upload.processUploadsToCloudinary(uploadReq, mockRes, mockNext);
  
  assert.strictEqual(nextCalled, true, 'processUploadsToCloudinary should call next()');
  assert.ok(mockFile.secure_url, 'File should have a secure_url populated');
  assert.ok(mockFile.secure_url.includes('https://res.cloudinary.com/vadgpisw/video/upload/'), `URL should be on vadgpisw video upload path: ${mockFile.secure_url}`);
  assert.strictEqual(mockFile.resource_type, 'video');
  console.log('  ✔ Video uploaded to Cloudinary:');
  console.log(`    secure_url: ${mockFile.secure_url}`);
  console.log(`    public_id: ${mockFile.public_id}`);

  // Test 3: Save lesson with uploaded video
  console.log('\nTest 3: Saving Lesson with Verified Cloudinary Video');
  statusCaptured = null;
  jsonResponse = null;

  const validAddReq = {
    params: { courseId: mockCourse._id.toString(), moduleId },
    body: {
      lessonTitle: 'Organon Lecture 1',
      lessonType: 'Recorded Video',
      durationOrPages: '30 mins',
      // Pass a fake URL that should get filtered out in favor of the real uploaded file
      videoParts: JSON.stringify([{ title: 'Old Broken', url: 'https://res.cloudinary.com/doxb5l5vf/video/upload/fake.mp4' }])
    },
    file: null,
    files: [mockFile]
  };

  await courseController.addLesson(validAddReq, mockRes);
  assert.strictEqual(statusCaptured, 201, 'Lesson should be successfully created');
  assert.strictEqual(jsonResponse.success, true);
  
  const savedLesson = jsonResponse.data;
  assert.strictEqual(savedLesson.lessonTitle, 'Organon Lecture 1');
  assert.strictEqual(savedLesson.videoParts.length, 1);
  assert.ok(savedLesson.videoParts[0].url.includes('vadgpisw'), 'Saved videoPart should be vadgpisw');
  assert.ok(!savedLesson.videoParts[0].url.includes('doxb5l5vf'), 'Fake doxb5l5vf URL must NOT be saved');
  assert.strictEqual(savedLesson.videoUrl, savedLesson.videoParts[0].url);
  console.log('  ✔ Lesson saved successfully with confirmed Cloudinary streaming URL:');
  console.log(`    videoUrl: ${savedLesson.videoUrl}`);

  // Restore Course.findOne
  Course.findOne = originalFindOne;

  console.log('\n🎉 ALL VIDEO UPLOAD FLOW CHECKS PASSED PERFECTLY!');
}

runVideoUploadDiagnostic().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
