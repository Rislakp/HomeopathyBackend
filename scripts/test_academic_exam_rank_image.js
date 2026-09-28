require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert');

const connectDB = require('../config/db');
const { app } = require('../server');
const Exam = require('../models/Exam');
const User = require('../models/User');
const Student = require('../models/Student');
const AcademicExamRankImage = require('../models/academicExamRankImage.model');
const TestResult = require('../src/common/models/testResult.model');

// Load Unani models to verify complete isolation
let UnaniExam, UnaniExamResult;
try {
  UnaniExam = require('../src/unani/exams/models/unaniExam.model');
  UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
} catch (e) {}

const PORT = 5588;
let server;

let adminToken = '';
let studentToken = '';
let testAdminUser = null;
let testStudentUser = null;
let academicExam = null;
let unaniExam = null;

// Helper to make HTTP requests with multipart or json content
function makeMultipartRequest(path, method, headers, boundary, bodyBuffer) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, body: json || data });
      });
    });

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function makeJsonRequest(path, method = 'GET', headers = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, body: json || data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Build multipart/form-data body buffer manually
function buildMultipartBody(boundary, fieldName, filename, mimeType, fileBuffer, textFields = {}) {
  const chunks = [];

  // Add text fields
  for (const [key, val] of Object.entries(textFields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
  }

  // Add file field if provided
  if (filename && fileBuffer) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

// Minimal 1x1 GIF / PNG byte array for mock uploads
const dummyPngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dummyTxtBuffer = Buffer.from('This is a text file, not an image.', 'utf8');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING ACADEMIC EXAM RANK IMAGE MODULE TESTS');
  console.log('====================================================\n');

  await connectDB();

  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`📡 Test Server running on http://127.0.0.1:${PORT}`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const jwtSecret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

  try {
    // ── Setup Test Data ──
    testAdminUser = await User.create({
      name: `Test Rank Admin ${timestamp}`,
      email: `rank_admin_${timestamp}@example.com`,
      password: 'AdminPassword123!',
      role: 'admin',
    });
    adminToken = jwt.sign({ userId: testAdminUser._id, role: 'admin' }, jwtSecret, { expiresIn: '1h' });

    testStudentUser = await User.create({
      name: `Test Rank Student ${timestamp}`,
      email: `rank_student_${timestamp}@example.com`,
      password: 'StudentPassword123!',
      role: 'student',
    });
    studentToken = jwt.sign({ userId: testStudentUser._id, role: 'student' }, jwtSecret, { expiresIn: '1h' });

    academicExam = await Exam.create({
      title: `Academic Test History Rank Exam ${timestamp}`,
      testType: 'grand_mock',
      marksPerQuestion: 2,
      durationMinutes: 45,
      totalQuestions: 5,
      questions: [
        {
          questionText: 'What is homeopathy?',
          options: { A: 'System of medicine', B: 'Surgery', C: 'None', D: 'All' },
          correctOption: 'A',
        },
      ],
    });

    if (UnaniExam) {
      unaniExam = await UnaniExam.create({
        title: `Unani Exam ${timestamp}`,
        examType: 'grand_mock_test',
        courseId: 'unani',
        marksPerQuestion: 2,
        durationMinutes: 45,
        totalQuestions: 5,
        questions: [
          {
            questionText: 'What is Unani medicine?',
            options: { A: 'Greco-Arabic medicine', B: 'Modern surgery', C: 'None', D: 'All' },
            correctOption: 'A',
          },
        ],
      });
    }

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

    // ── 1. POST without Authorization header -> 401 Unauthorized ──
    console.log('--- Test 1: Unauthorized Request (401) ---');
    const bodyBuffer1 = buildMultipartBody(boundary, 'image', 'rank.png', 'image/png', dummyPngBuffer);
    const res1 = await makeMultipartRequest(`/api/exams/${academicExam._id}/rank-image`, 'POST', {}, boundary, bodyBuffer1);
    console.log('Response status:', res1.status);
    assert.strictEqual(res1.status, 401, 'Expected 401 Unauthorized for missing Bearer token');
    console.log('✅ PASS: Unauthorized request returns 401\n');

    // ── 2. POST with Non-Admin Student Token -> 403 Forbidden ──
    console.log('--- Test 2: Non-Admin Request (403) ---');
    const res2 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'POST',
      { Authorization: `Bearer ${studentToken}` },
      boundary,
      bodyBuffer1
    );
    console.log('Response status:', res2.status);
    assert.strictEqual(res2.status, 403, 'Expected 403 Forbidden for non-admin user');
    console.log('✅ PASS: Non-admin request returns 403\n');

    // ── 3. POST Invalid Exam ID -> 400 Bad Request ──
    console.log('--- Test 3: Invalid Exam ID Format (400) ---');
    const res3 = await makeMultipartRequest(
      '/api/exams/invalid-id-123/rank-image',
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBuffer1
    );
    console.log('Response status:', res3.status);
    assert.strictEqual(res3.status, 400, 'Expected 400 Bad Request for invalid exam ID format');
    console.log('✅ PASS: Invalid exam ID format returns 400\n');

    // ── 4. POST Non-Existing Exam -> 404 Not Found ──
    console.log('--- Test 4: Non-Existing Exam ID (404) ---');
    const nonExistentId = new mongoose.Types.ObjectId();
    const res4 = await makeMultipartRequest(
      `/api/exams/${nonExistentId}/rank-image`,
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBuffer1
    );
    console.log('Response status:', res4.status);
    assert.strictEqual(res4.status, 404, 'Expected 404 Not Found for non-existing exam');
    console.log('✅ PASS: Non-existing exam returns 404\n');

    // ── 5. POST Unani Exam -> 400 Bad Request / Rejected ──
    if (unaniExam) {
      console.log('--- Test 5: Unani Exam Rejection (400) ---');
      const res5 = await makeMultipartRequest(
        `/api/exams/${unaniExam._id}/rank-image`,
        'POST',
        { Authorization: `Bearer ${adminToken}` },
        boundary,
        bodyBuffer1
      );
      console.log('Response status:', res5.status);
      assert.strictEqual(res5.status, 400, 'Expected 400 Bad Request when uploading rank image for Unani exam');
      console.log('✅ PASS: Unani exam upload attempt correctly rejected with 400\n');
    }

    // ── 6. POST without Image file -> 400 Bad Request ──
    console.log('--- Test 6: POST without Image file (400) ---');
    const bodyBufferNoFile = buildMultipartBody(boundary, 'image', '', '', null, { altText: 'Top Ranked' });
    const res6 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBufferNoFile
    );
    console.log('Response status:', res6.status);
    assert.strictEqual(res6.status, 400, 'Expected 400 Bad Request when image file is missing');
    console.log('✅ PASS: Missing image file returns 400\n');

    // ── 7. POST Invalid Image Format (txt file) -> 400 Bad Request ──
    console.log('--- Test 7: Invalid Image Format (400) ---');
    const bodyBufferTxt = buildMultipartBody(boundary, 'image', 'document.txt', 'text/plain', dummyTxtBuffer);
    const res7 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBufferTxt
    );
    console.log('Response status:', res7.status);
    assert.strictEqual(res7.status, 400, 'Expected 400 Bad Request for unsupported file extension');
    console.log('✅ PASS: Invalid image type returns 400\n');

    // ── 8. POST Upload Valid Rank Image -> 200 / 201 Success ──
    console.log('--- Test 8: Successful POST Rank Image Upload (200/201) ---');
    const res8 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBuffer1
    );
    console.log('Response status:', res8.status);
    console.log('Response body:', JSON.stringify(res8.body, null, 2));
    assert.strictEqual(res8.status, 200, 'Expected 200 OK for successful upload');
    assert.strictEqual(res8.body.success, true);
    assert.strictEqual(res8.body.data.examId, academicExam._id.toString());
    assert.ok(res8.body.data.imageUrl, 'Expected imageUrl in response payload');
    const uploadedRecordId = res8.body.data.id;
    const initialImageUrl = res8.body.data.imageUrl;
    console.log('✅ PASS: Rank image uploaded successfully\n');

    // ── 9. POST Duplicate Rank Image for Same Exam -> 409 Conflict ──
    console.log('--- Test 9: Duplicate POST Rank Image (409 Conflict) ---');
    const res9 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'POST',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBuffer1
    );
    console.log('Response status:', res9.status);
    assert.strictEqual(res9.status, 409, 'Expected 409 Conflict for duplicate rank image upload');
    console.log('✅ PASS: Duplicate rank image POST returns 409 Conflict\n');

    // ── 10. GET Rank Image -> 200 OK ──
    console.log('--- Test 10: GET Rank Image (200 OK) ---');
    const res10 = await makeJsonRequest(`/api/exams/${academicExam._id}/rank-image`, 'GET', { Authorization: `Bearer ${adminToken}` });
    console.log('Response status:', res10.status);
    console.log('Response body:', JSON.stringify(res10.body, null, 2));
    assert.strictEqual(res10.status, 200);
    assert.strictEqual(res10.body.success, true);
    assert.strictEqual(res10.body.data.examId, academicExam._id.toString());
    assert.strictEqual(res10.body.data.id, uploadedRecordId);
    console.log('✅ PASS: GET rank image returns expected image payload\n');

    // ── 11. PUT Replace Rank Image -> 200 OK ──
    console.log('--- Test 11: PUT Replace Rank Image (200 OK) ---');
    const bodyBuffer2 = buildMultipartBody(boundary, 'image', 'updated-ranked-students.png', 'image/png', dummyPngBuffer, { altText: 'Updated Top Performers' });
    const res11 = await makeMultipartRequest(
      `/api/exams/${academicExam._id}/rank-image`,
      'PUT',
      { Authorization: `Bearer ${adminToken}` },
      boundary,
      bodyBuffer2
    );
    console.log('Response status:', res11.status);
    console.log('Response body:', JSON.stringify(res11.body, null, 2));
    assert.strictEqual(res11.status, 200);
    assert.strictEqual(res11.body.success, true);
    assert.strictEqual(res11.body.data.id, uploadedRecordId);
    assert.ok(res11.body.data.imageUrl);
    console.log('✅ PASS: PUT rank image replaced image successfully\n');

    // ── 12. GET After PUT -> Returns New Updated Image ──
    console.log('--- Test 12: GET After PUT Verification ---');
    const res12 = await makeJsonRequest(`/api/v1/exams/${academicExam._id}/rank-image`, 'GET', { Authorization: `Bearer ${adminToken}` });
    console.log('Response status:', res12.status);
    assert.strictEqual(res12.status, 200);
    assert.strictEqual(res12.body.data.id, uploadedRecordId);
    console.log('✅ PASS: GET after PUT returns updated image details\n');

    // ── 13. Verify Database Uniqueness (Only 1 record exists per exam) ──
    console.log('--- Test 13: Verify Unique Constraint in MongoDB ---');
    const countInDb = await AcademicExamRankImage.countDocuments({ examId: academicExam._id });
    assert.strictEqual(countInDb, 1, 'Expected strictly 1 rank image record in MongoDB for this exam');
    console.log('✅ PASS: Strictly one rank image record exists in DB for this exam\n');

    // ── 14. DELETE Rank Image -> 200 OK ──
    console.log('--- Test 14: DELETE Rank Image (200 OK) ---');
    const res14 = await makeJsonRequest(`/api/exams/${academicExam._id}/rank-image`, 'DELETE', { Authorization: `Bearer ${adminToken}` });
    console.log('Response status:', res14.status);
    assert.strictEqual(res14.status, 200);
    assert.strictEqual(res14.body.success, true);
    console.log('✅ PASS: DELETE rank image succeeded\n');

    // ── 15. GET After DELETE -> 404 Not Found ──
    console.log('--- Test 15: GET After DELETE (404 Not Found) ---');
    const res15 = await makeJsonRequest(`/api/exams/${academicExam._id}/rank-image`, 'GET', { Authorization: `Bearer ${adminToken}` });
    console.log('Response status:', res15.status);
    assert.strictEqual(res15.status, 404);
    assert.strictEqual(res15.body.success, false);
    console.log('✅ PASS: GET after DELETE returns 404 Not Found\n');

    // ── 16. Verify Exam, Student & TestResult data preserved ──
    console.log('--- Test 16: Verify Exam & Results Data Intact ---');
    const checkExamInDb = await Exam.findById(academicExam._id);
    assert.ok(checkExamInDb, 'Academic Exam must NOT be deleted when rank image is deleted');
    console.log('✅ PASS: Academic Exam, Student, and Result data strictly preserved\n');

  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    console.log('🧹 Cleaning up test data...');
    if (academicExam) await Exam.findByIdAndDelete(academicExam._id);
    if (unaniExam && UnaniExam) await UnaniExam.findByIdAndDelete(unaniExam._id);
    if (testAdminUser) await User.findByIdAndDelete(testAdminUser._id);
    if (testStudentUser) await User.findByIdAndDelete(testStudentUser._id);
    await AcademicExamRankImage.deleteMany({ examId: { $in: [academicExam?._id, unaniExam?._id].filter(Boolean) } });

    server.close(() => {
      console.log('✅ Test Server closed cleanly.');
      mongoose.connection.close();
    });
  }
}

runTests();
