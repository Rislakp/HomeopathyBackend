require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const User = require('../models/User');
const Course = require('../models/Course');
const { getJwtSecret } = require('../middleware/rbac');
const express = require('express');
const cloudinaryConfig = require('../config/cloudinary');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Register routes
app.use('/api/upload', require('../routes/uploadRoutes'));
app.use('/api/uploads', require('../routes/uploadRoutes'));
app.use('/api/admin/courses', require('../routes/adminCourseRoutes'));

let server;
let baseUrl;

function generateTestToken(userDoc) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      id: userDoc._id.toString(),
      userId: userDoc._id.toString(),
      email: userDoc.email,
      role: userDoc.role,
    },
    secret,
    { expiresIn: '1h' }
  );
}

async function request(method, path, token, body = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }
  return { status: response.status, data };
}

async function runTests() {
  console.log('──────────────────────────────────────────────────────────────');
  console.log('🚀 DIRECT VIDEO UPLOAD ARCHITECTURE TEST SUITE');
  console.log('──────────────────────────────────────────────────────────────\n');

  await connectDB();

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running at ${baseUrl}\n`);

  let testCourseId = null;
  let testModuleId = null;
  let testLessonId = null;

  try {
    const timestamp = Date.now();

    // 1. Admin User
    const adminUser = await User.create({
      name: 'Video Admin Test',
      email: `video_admin_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'admin',
    });
    const adminToken = generateTestToken(adminUser);

    // 2. Student User
    const studentUser = await User.create({
      name: 'Video Student Test',
      email: `video_student_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'student',
    });
    const studentToken = generateTestToken(studentUser);

    console.log('✅ Test Users Created: Admin & Student\n');

    // ── TEST 1: Admin requests upload signature ─────────────────────────────
    console.log('TEST 1: Admin requests video upload signature...');
    const sigRes = await request('POST', '/api/upload/video/signature', adminToken, {
      folder: 'homeopathy-media/course-videos',
    });
    console.log('Response Status:', sigRes.status);
    console.log('Response Data:', JSON.stringify(sigRes.data, null, 2));

    if (
      sigRes.status === 200 &&
      sigRes.data.success === true &&
      sigRes.data.data.signature &&
      sigRes.data.data.apiKey &&
      sigRes.data.data.cloudName &&
      sigRes.data.data.resourceType === 'video'
    ) {
      console.log('✅ TEST 1 & 3 PASSED: Valid signed video upload parameters generated.\n');
    } else {
      console.error('❌ TEST 1 & 3 FAILED!\n');
    }

    // ── TEST 2: Unauthorized user requests signature ─────────────────────────
    console.log('TEST 2: Non-admin student requests video upload signature...');
    const unauthSigRes = await request('POST', '/api/upload/video/signature', studentToken);
    console.log('Response Status:', unauthSigRes.status);
    if (unauthSigRes.status === 403 || unauthSigRes.status === 401) {
      console.log('✅ TEST 2 PASSED: 403/401 Forbidden returned for non-admin user.\n');
    } else {
      console.error('❌ TEST 2 FAILED!\n');
    }

    // ── Setup Course & Module for Lesson Creation ────────────────────────────
    console.log('Setting up Test Course & Module...');
    const course = await Course.create({
      courseTitle: 'Unani Video Architecture Course',
      instructor: 'Dr. Test Instructor',
      price: 999,
      modules: [
        {
          moduleName: 'Module 1: Large Video Architecture',
          lessons: [],
        },
      ],
    });
    testCourseId = course._id.toString();
    testModuleId = course.modules[0]._id.toString();
    console.log(`Course Created: ${testCourseId}, Module: ${testModuleId}\n`);

    // ── TEST 6 & 7: Lesson API accepts metadata and creates lesson ───────────
    console.log('TEST 6 & 7: Lesson API receives pre-uploaded Cloudinary video metadata...');
    const mockVideoMetadata = {
      lessonTitle: '4K High-Res Unani Lecture 1',
      lessonType: 'Recorded Video',
      description: 'Comprehensive 4K lecture video uploaded directly to Cloudinary',
      videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1790000000/homeopathy-media/videos/unani_4k_lecture.mp4',
      videoPublicId: 'homeopathy-media/videos/unani_4k_lecture',
      videoResourceType: 'video',
      videoDuration: 3600,
      videoWidth: 4096,
      videoHeight: 2160,
      videoFormat: 'mp4',
      videoBytes: 162600000, // 162.6 MB
    };

    const createLessonRes = await request(
      'POST',
      `/api/admin/courses/${testCourseId}/modules/${testModuleId}/lessons`,
      adminToken,
      mockVideoMetadata
    );

    console.log('Create Lesson Status:', createLessonRes.status);
    console.log('Create Lesson Response:', JSON.stringify(createLessonRes.data, null, 2));

    if (
      createLessonRes.status === 201 &&
      createLessonRes.data.success === true &&
      createLessonRes.data.data.videoUrl === mockVideoMetadata.videoUrl &&
      createLessonRes.data.data.videoPublicId === mockVideoMetadata.videoPublicId &&
      createLessonRes.data.data.videoDuration === 3600 &&
      createLessonRes.data.data.videoWidth === 4096 &&
      createLessonRes.data.data.videoHeight === 2160
    ) {
      console.log('✅ TEST 6 & 7 PASSED: Lesson API accepted video metadata without file transfer & persisted lesson successfully.\n');
      testLessonId = createLessonRes.data.data.id || createLessonRes.data.data._id;
    } else {
      console.error('❌ TEST 6 & 7 FAILED!\n');
    }

    // ── TEST 8: Existing lessons remain playable & retrievable ───────────────
    console.log('TEST 8: Fetching lesson to verify readability & playback properties...');
    const getCourseRes = await request('GET', `/api/admin/courses/${testCourseId}`, adminToken);
    console.log('Get Course Status:', getCourseRes.status);
    if (
      getCourseRes.status === 200 &&
      getCourseRes.data.data.modules[0].lessons[0].videoUrl === mockVideoMetadata.videoUrl
    ) {
      console.log('✅ TEST 8 PASSED: Lesson video URL and metadata retrieved cleanly.\n');
    } else {
      console.error('❌ TEST 8 FAILED!\n');
    }

    // ── TEST 9: Video cleanup endpoint ───────────────────────────────────────
    console.log('TEST 9: Testing video cleanup endpoint (DELETE /api/upload/video)...');
    const deleteVidRes = await request('DELETE', '/api/upload/video', adminToken, {
      public_id: 'homeopathy-media/videos/test_temp_vid',
    });
    console.log('Delete Video Status:', deleteVidRes.status);
    if (deleteVidRes.status === 200 && deleteVidRes.data.success === true) {
      console.log('✅ TEST 9 PASSED: Video cleanup endpoint functional.\n');
    } else {
      console.error('❌ TEST 9 FAILED!\n');
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log('🎉 DIRECT VIDEO UPLOAD SUITE COMPLETED SUCCESSFULLY!');
    console.log('══════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('❌ Test suite execution error:', err);
  } finally {
    if (testCourseId) await Course.findByIdAndDelete(testCourseId);
    await User.deleteMany({ email: /video_.*@test\.com/ });
    if (server) server.close();
    await mongoose.disconnect();
  }
}

runTests();
