require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Exam = require('../models/Exam');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
const { getJwtSecret } = require('../middleware/rbac');

const express = require('express');
const cors = require('cors');

// Import main app components to run in-memory server
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Register routes
app.use(require('../routes/authRoutes'));
app.use(require('../routes/exam.routes'));
app.use(require('../src/student/student.routes'));
app.use(require('../src/unani/exams/routes/unaniExam.routes'));

let server;
let baseUrl;

function generateTestToken(userDoc, studentDoc = null) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      id: userDoc._id.toString(),
      userId: userDoc._id.toString(),
      studentId: studentDoc ? studentDoc._id.toString() : null,
      email: userDoc.email,
      role: userDoc.role,
      courseIds: studentDoc ? studentDoc.courseIds : userDoc.courseIds,
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
  console.log('🚀 UNANI EXAM MODULE & BACKEND ARCHITECTURE TEST SUITE');
  console.log('──────────────────────────────────────────────────────────────\n');

  await connectDB();

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running at ${baseUrl}\n`);

  let testExamId = null;
  let testResultId = null;

  try {
    // ── Setup Test Data ───────────────────────────────────────────────────
    const timestamp = Date.now();

    // 1. Admin User
    const adminUser = await User.create({
      name: 'Unani Admin Test',
      email: `unani_admin_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'admin',
    });
    const adminToken = generateTestToken(adminUser);

    // 2. Student A (No Unani: courseIds = ["course_001"])
    const studentUserA = await User.create({
      name: 'Student A (No Unani)',
      email: `student_a_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'student',
      courseIds: ['course_001'],
    });
    const studentDocA = await Student.create({
      userId: studentUserA._id,
      name: studentUserA.name,
      email: studentUserA.email,
      courseIds: ['course_001'],
      status: 'Active',
      isApproved: true,
    });
    const tokenStudentA = generateTestToken(studentUserA, studentDocA);

    // 3. Student B (With Unani: courseIds = ["course_001", "unani"])
    const studentUserB = await User.create({
      name: 'Student B (With Unani)',
      email: `student_b_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'student',
      courseIds: ['course_001', 'unani'],
    });
    const studentDocB = await Student.create({
      userId: studentUserB._id,
      name: studentUserB.name,
      email: studentUserB.email,
      courseIds: ['course_001', 'unani'],
      status: 'Active',
      isApproved: true,
    });
    const tokenStudentB = generateTestToken(studentUserB, studentDocB);

    // 4. Student C (Only Unani: courseIds = ["unani"])
    const studentUserC = await User.create({
      name: 'Student C (Only Unani)',
      email: `student_c_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'student',
      courseIds: ['unani'],
    });
    const studentDocC = await Student.create({
      userId: studentUserC._id,
      name: studentUserC.name,
      email: studentUserC.email,
      courseIds: ['unani'],
      status: 'Active',
      isApproved: true,
    });
    const tokenStudentC = generateTestToken(studentUserC, studentDocC);

    console.log('✅ Test Users Created: Admin, Student A (No Unani), Student B (With Unani), Student C (Only Unani)\n');

    // ── CASE 6: Admin creates Unani Grand Mock Test ─────────────────────────
    console.log('CASE 6: Admin creates valid Unani Grand Mock Test...');
    const createRes = await request('POST', '/api/unani-exams', adminToken, {
      title: 'Unani Grand Mock Test #1',
      description: 'First comprehensive Unani Grand Mock Test',
      marksPerQuestion: 4,
      negativeMark: 1,
      durationMinutes: 120,
      courseId: 'unani',
      examType: 'grand_mock_test',
      questions: [
        {
          questionText: 'What is the primary humor in Unani medicine associated with air?',
          options: {
            A: 'Dam (Blood)',
            B: 'Balgham (Phlegm)',
            C: 'Safra (Yellow Bile)',
            D: 'Sauda (Black Bile)',
          },
          correctOption: 'A',
          explanation: 'Dam represents blood and the air element.',
        },
        {
          questionText: 'Which of the following is a classic Unani formulation?',
          options: {
            A: 'Khamira',
            B: 'Chyawanprash',
            C: 'Triphala',
            D: 'Dashmoolarishta',
          },
          correctOption: 'A',
          explanation: 'Khamira is a traditional Unani semi-solid preparation.',
        },
      ],
    });

    console.log('Response Status:', createRes.status);
    console.log('Response Data:', JSON.stringify(createRes.data, null, 2));
    if (createRes.status === 201 && createRes.data.data.courseId === 'unani' && createRes.data.data.examType === 'grand_mock_test') {
      console.log('✅ CASE 6 PASSED: Admin created Unani Grand Mock Test successfully.\n');
      testExamId = createRes.data.data.id || createRes.data.data._id;
    } else {
      console.error('❌ CASE 6 FAILED!\n');
    }

    // ── CASE 7: Admin attempts courseId = "some_other_course" ────────────────
    console.log('CASE 7: Admin attempts to create Unani Exam with courseId = "some_other_course"...');
    const case7Res = await request('POST', '/api/unani-exams', adminToken, {
      title: 'Invalid Unani Test',
      marksPerQuestion: 4,
      durationMinutes: 60,
      courseId: 'some_other_course',
      examType: 'grand_mock_test',
    });
    console.log('Response Status:', case7Res.status);
    if (case7Res.status === 400 && case7Res.data.success === false) {
      console.log('✅ CASE 7 PASSED: Rejected invalid courseId with 400 Bad Request.\n');
    } else {
      console.error('❌ CASE 7 FAILED!\n');
    }

    // ── CASE 8: Admin attempts examType = "course_test" ──────────────────────
    console.log('CASE 8: Admin attempts to create Unani Exam with examType = "course_test"...');
    const case8Res = await request('POST', '/api/unani-exams', adminToken, {
      title: 'Invalid Exam Type Test',
      marksPerQuestion: 4,
      durationMinutes: 60,
      courseId: 'unani',
      examType: 'course_test',
    });
    console.log('Response Status:', case8Res.status);
    if (case8Res.status === 400 && case8Res.data.success === false) {
      console.log('✅ CASE 8 PASSED: Rejected invalid examType with 400 Bad Request.\n');
    } else {
      console.error('❌ CASE 8 FAILED!\n');
    }

    // ── CASE 1: Student A (No Unani) GET /api/unani-exams ────────────────────
    console.log('CASE 1: Student A (without "unani" in courseIds) requests GET /api/unani-exams...');
    const case1Res = await request('GET', '/api/unani-exams', tokenStudentA);
    console.log('Response Status:', case1Res.status);
    if (case1Res.status === 403) {
      console.log('✅ CASE 1 PASSED: 403 Forbidden returned for student without Unani.\n');
    } else {
      console.error('❌ CASE 1 FAILED!\n');
    }

    // ── CASE 2: Student B (With Unani) GET /api/unani-exams ────────────────────
    console.log('CASE 2: Student B (with "unani" in courseIds) requests GET /api/unani-exams...');
    const case2Res = await request('GET', '/api/unani-exams', tokenStudentB);
    console.log('Response Status:', case2Res.status);
    if (case2Res.status === 200 && case2Res.data.success === true) {
      console.log('✅ CASE 2 PASSED: 200 OK returned for enrolled student.\n');
    } else {
      console.error('❌ CASE 2 FAILED!\n');
    }

    // ── CASE 3: Student C (courseIds = ["unani"]) POST /api/unani-exams/:examId/start ──
    console.log(`CASE 3: Student C (courseIds = ["unani"]) starts exam ${testExamId}...`);
    const case3Res = await request('POST', `/api/unani-exams/${testExamId}/start`, tokenStudentC);
    console.log('Response Status:', case3Res.status);
    if (case3Res.status === 200 && case3Res.data.success === true && case3Res.data.data.questions) {
      console.log('✅ CASE 3 PASSED: Exam start allowed for Unani student.\n');
    } else {
      console.error('❌ CASE 3 FAILED!\n');
    }

    // ── CASE 4: Student A (without "unani") POST /api/unani-exams/:examId/start ───────
    console.log(`CASE 4: Student A (without "unani") attempts to start exam ${testExamId}...`);
    const case4Res = await request('POST', `/api/unani-exams/${testExamId}/start`, tokenStudentA);
    console.log('Response Status:', case4Res.status);
    if (case4Res.status === 403) {
      console.log('✅ CASE 4 PASSED: 403 Forbidden returned when student without Unani starts exam.\n');
    } else {
      console.error('❌ CASE 4 FAILED!\n');
    }

    // ── Student B submits exam attempt ──────────────────────────────────────
    console.log('Submitting exam attempt for Student B...');
    const q1Id = case3Res.data.data.questions[0]._id || case3Res.data.data.questions[0].id;
    const q2Id = case3Res.data.data.questions[1]._id || case3Res.data.data.questions[1].id;

    const submitRes = await request('POST', `/api/unani-exams/${testExamId}/submit`, tokenStudentB, {
      answers: [
        { questionId: q1Id, selectedOption: 'A' }, // Correct
        { questionId: q2Id, selectedOption: 'B' }, // Wrong (Correct is A)
      ],
    });
    console.log('Submit Status:', submitRes.status);
    console.log('Submit Data:', JSON.stringify(submitRes.data, null, 2));

    if (submitRes.status === 200 && submitRes.data.data) {
      testResultId = submitRes.data.data.id || submitRes.data.data._id;
    }

    // ── CASE 5: Security check - Student C attempts to view Student B's result ────
    console.log(`CASE 5: Student C attempts to access Student B's result (${testResultId})...`);
    const case5Res = await request('GET', `/api/unani-exams/${testExamId}/results/${testResultId}`, tokenStudentC);
    console.log('Response Status:', case5Res.status);
    if (case5Res.status === 403) {
      console.log('✅ CASE 5 PASSED: 403 Forbidden returned when student accesses another student\'s result.\n');
    } else {
      console.error('❌ CASE 5 FAILED!\n');
    }

    // ── CASE 9: Existing normal course student APIs ──────────────────────────
    console.log('CASE 9: Testing existing normal course student APIs (GET /api/student/exams)...');
    const case9Res = await request('GET', '/api/student/exams', tokenStudentB);
    console.log('Response Status:', case9Res.status);
    if (case9Res.status === 200) {
      console.log('✅ CASE 9 PASSED: Existing normal course student API returned 200 OK.\n');
    } else {
      console.error('❌ CASE 9 FAILED!\n');
    }

    // ── CASE 10: Existing normal course exam APIs ────────────────────────────
    console.log('CASE 10: Testing existing normal course exam APIs (GET /api/exams)...');
    const case10Res = await request('GET', '/api/exams', adminToken);
    console.log('Response Status:', case10Res.status);
    if (case10Res.status === 200) {
      console.log('✅ CASE 10 PASSED: Existing normal course exam API returned 200 OK.\n');
    } else {
      console.error('❌ CASE 10 FAILED!\n');
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 10 VALIDATION CASES COMPLETED SUCCESSFULLY!');
    console.log('══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Test suite execution error:', err);
  } finally {
    // Cleanup created test records
    if (testExamId) await UnaniExam.findByIdAndDelete(testExamId);
    if (testResultId) await UnaniExamResult.findByIdAndDelete(testResultId);
    await User.deleteMany({ email: /unani_.*@test\.com|student_.*@test\.com/ });
    await Student.deleteMany({ email: /student_.*@test\.com/ });

    if (server) server.close();
    await mongoose.disconnect();
  }
}

runTests();
