require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const User = require('../models/User');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const TestResult = require('../src/common/models/testResult.model');
const { getJwtSecret } = require('../middleware/rbac');

let server;
const PORT = 5592;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING STUDENT RESULTS AUTHORIZATION & ROUTE FIX');
  console.log('====================================================\n');

  await connectDB();
  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}\n`);

  let passed = 0;
  let failed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      if (details) console.error(`     Details:`, details);
      failed++;
    }
  }

  const realStudent = await User.findOne({ role: 'student' }).lean();
  let studentUser = realStudent;
  if (!studentUser) {
    studentUser = await User.create({
      name: 'Testing Student',
      email: `test_student_${Date.now()}@whitecoat.academy`,
      role: 'student',
      isApproved: true,
      accountStatus: 'Approved',
    });
  }

  const otherStudent = await User.findOne({ role: 'student', _id: { $ne: studentUser._id } }).lean();
  let otherStudentUser = otherStudent;
  if (!otherStudentUser) {
    otherStudentUser = await User.create({
      name: 'Other Student',
      email: `other_student_${Date.now()}@whitecoat.academy`,
      role: 'student',
      isApproved: true,
      accountStatus: 'Approved',
    });
  }

  const secret = getJwtSecret();

  // Create mock student user tokens
  const studentToken = jwt.sign(
    {
      id: studentUser._id.toString(),
      userId: studentUser._id.toString(),
      role: 'student',
      email: studentUser.email,
      isApproved: true,
    },
    secret,
    { expiresIn: '1h' }
  );

  const otherStudentToken = jwt.sign(
    {
      id: otherStudentUser._id.toString(),
      userId: otherStudentUser._id.toString(),
      role: 'student',
      email: otherStudentUser.email,
      isApproved: true,
    },
    secret,
    { expiresIn: '1h' }
  );

  try {
    // -------------------------------------------------------------
    // Test 1: Unauthenticated request -> 401
    // -------------------------------------------------------------
    console.log('--- Test 1: Unauthenticated GET /api/student/results ---');
    const res1 = await request('/api/student/results');
    assert('Unauthenticated request returns 401', res1.status === 401, res1);

    // -------------------------------------------------------------
    // Test 2: Authenticated student GET /api/student/results -> 200 OK (NOT 403)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Authenticated Student GET /api/student/results ---');
    const res2 = await request('/api/student/results', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert('Returns 200 OK (not 403 Forbidden)', res2.status === 200, res2);
    assert('Success flag is true', res2.body?.success === true, res2.body);
    assert('Data array exists', Array.isArray(res2.body?.data), res2.body);

    // -------------------------------------------------------------
    // Test 3: Authenticated student GET /api/v1/student/results -> 200 OK
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Authenticated Student GET /api/v1/student/results ---');
    const res3 = await request('/api/v1/student/results', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert('GET /api/v1/student/results returns 200 OK', res3.status === 200, res3);
    assert('v1 success flag is true', res3.body?.success === true, res3.body);

    // -------------------------------------------------------------
    // Test 4: Result Isolation (Student gets only own results)
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Result Isolation (Student gets only own results) ---');
    const testExam = await Exam.create({
      title: `Auth Verification Exam ${Date.now()}`,
      marksPerQuestion: 1,
      durationMinutes: 15,
      totalQuestions: 1,
      questions: [{
        questionText: 'Q1?',
        options: { A: '1', B: '2', C: '3', D: '4' },
        correctOption: 'A'
      }],
    });

    const studentResult = await TestResult.create({
      studentId: studentUser._id,
      examId: testExam._id,
      score: 1,
      totalQuestions: 1,
      correctAnswers: 1,
      incorrectAnswers: 0,
      unanswered: 0,
      accuracyPercentage: 100,
      status: 'Completed',
    });

    const otherResult = await TestResult.create({
      studentId: otherStudentUser._id,
      examId: testExam._id,
      score: 0,
      totalQuestions: 1,
      correctAnswers: 0,
      incorrectAnswers: 1,
      unanswered: 0,
      accuracyPercentage: 0,
      status: 'Completed',
    });

    const res4 = await request('/api/student/results', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert('Returns 200 OK with data', res4.status === 200, res4);
    const foundMyResult = (res4.body?.data || []).some(r => r._id === studentResult._id.toString());
    const foundOtherResult = (res4.body?.data || []).some(r => r._id === otherResult._id.toString());
    assert('Found test student result', foundMyResult, res4.body);
    assert('Did NOT find other student result', !foundOtherResult, res4.body);

    const res4Other = await request('/api/student/results', {
      headers: { Authorization: `Bearer ${otherStudentToken}` },
    });
    assert('Other student returns 200 OK', res4Other.status === 200, res4Other);
    const otherFoundHis = (res4Other.body?.data || []).some(r => r._id === otherResult._id.toString());
    const otherFoundMine = (res4Other.body?.data || []).some(r => r._id === studentResult._id.toString());
    assert('Other student found his own result', otherFoundHis, res4Other.body);
    assert('Other student did NOT find test student result', !otherFoundMine, res4Other.body);

    // -------------------------------------------------------------
    // Test 5: Verify other endpoints (/api/student/exams, /api/student/me, /api/students/profile)
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Regression check on other student endpoints ---');
    const resExams = await request('/api/student/exams', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert('GET /api/student/exams returns 200', resExams.status === 200, resExams);

    const resMe = await request('/api/student/me', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert('GET /api/student/me returns 200', resMe.status === 200, resMe);

    // Clean up test data
    await Exam.findByIdAndDelete(testExam._id);
    await TestResult.deleteMany({ _id: { $in: [studentResult._id, otherResult._id] } });

    console.log('\n====================================================');
    console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('====================================================\n');

    server.close();
    await mongoose.connection.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    if (server) server.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

runTests();
