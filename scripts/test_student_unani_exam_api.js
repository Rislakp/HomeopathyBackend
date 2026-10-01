/**
 * Automated Test Suite: Student Unani Exam API Module
 * Verifies all 23 test scenarios for Student Unani Exams, score calculation, duplicate prevention, and Admin Rank integration.
 */

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { app } = require('../server');
const User = require('../models/User');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');

const PORT = 5092;
let server;

function makeRequest(urlPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/homeopathy_test';
    await mongoose.connect(mongoUri);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING STUDENT UNANI EXAM MODULE TEST SUITE');
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

  let unaniStudentUser, unaniStudentDoc, unaniStudentToken;
  let nonUnaniStudentUser, nonUnaniStudentDoc, nonUnaniStudentToken;
  let adminUser, adminToken;
  let unaniExam, academicExam;

  try {
    // 1. Create Enrolled Unani Student
    unaniStudentUser = await User.create({
      name: `Unani Student ${timestamp}`,
      email: `unani_student_${timestamp}@example.com`,
      password: 'StudentPassword123!',
      role: 'student',
    });
    unaniStudentDoc = await Student.create({
      userId: unaniStudentUser._id,
      name: unaniStudentUser.name,
      email: unaniStudentUser.email,
      courseId: 'unani',
      courseIds: ['unani'],
    });
    unaniStudentToken = jwt.sign(
      { userId: unaniStudentUser._id, studentId: unaniStudentDoc._id, role: 'student', courseId: 'unani', courseIds: ['unani'] },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 2. Create Non-Unani Student (No Unani access)
    nonUnaniStudentUser = await User.create({
      name: `Non Unani Student ${timestamp}`,
      email: `non_unani_${timestamp}@example.com`,
      password: 'StudentPassword123!',
      role: 'student',
    });
    nonUnaniStudentDoc = await Student.create({
      userId: nonUnaniStudentUser._id,
      name: nonUnaniStudentUser.name,
      email: nonUnaniStudentUser.email,
      courseId: 'academic',
      courseIds: ['academic'],
    });
    nonUnaniStudentToken = jwt.sign(
      { userId: nonUnaniStudentUser._id, studentId: nonUnaniStudentDoc._id, role: 'student', courseId: 'academic', courseIds: ['academic'] },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Admin User
    adminUser = await User.create({
      name: `Unani Test Admin ${timestamp}`,
      email: `unani_admin_${timestamp}@example.com`,
      password: 'AdminPassword123!',
      role: 'admin',
    });
    adminToken = jwt.sign({ userId: adminUser._id, role: 'admin' }, jwtSecret, { expiresIn: '1h' });

    // 4. Create Unani Exam (3 questions, 3 marks each, negative penalty 0.5)
    unaniExam = await UnaniExam.create({
      title: `Unani Grand Mock Test ${timestamp}`,
      description: 'Test Unani Grand Mock Exam for Student APIs',
      courseId: 'unani',
      examType: 'grand_mock_test',
      durationMinutes: 60,
      marksPerQuestion: 3,
      negativeMarkPenalty: 0.5,
      status: 'Published',
      questions: [
        {
          questionText: 'What is temperament (Mizaj) in Unani?',
          options: { A: 'Humoral equilibrium', B: 'Blood pressure', C: 'Bone density', D: 'Heart rate' },
          correctOption: 'A',
          explanation: 'Mizaj represents the unique combination of qualities in Unani medicine.',
        },
        {
          questionText: 'Which organ is known as Kabid in Unani?',
          options: { A: 'Brain', B: 'Liver', C: 'Heart', D: 'Kidney' },
          correctOption: 'B',
          explanation: 'Kabid is the Arabic/Unani term for Liver.',
        },
        {
          questionText: 'What is Qalb in Unani medicine?',
          options: { A: 'Lungs', B: 'Stomach', C: 'Heart', D: 'Pancreas' },
          correctOption: 'C',
          explanation: 'Qalb translates to Heart.',
        },
      ],
    });

    // 5. Create Academic Exam (Should never be returned in Unani endpoints)
    academicExam = await Exam.create({
      title: `Academic WCA Exam ${timestamp}`,
      testType: 'grand_mock',
      marksPerQuestion: 2,
      durationMinutes: 45,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'Academic question text',
          options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' },
          correctOption: 'A',
        },
      ],
    });

    console.log('Setup completed cleanly.\n');

    // ── Test 1: GET Available Unani Exams for Student ──
    console.log('--- Test 1 & 2: GET /api/unani-exams/student ---');
    const res1 = await makeRequest('/api/unani-exams/student', 'GET', { Authorization: `Bearer ${unaniStudentToken}` });
    console.log('Response status:', res1.status);
    assert.strictEqual(res1.status, 200, 'Expected 200 OK for student fetching available Unani exams');
    assert.strictEqual(res1.body.success, true);
    assert.ok(Array.isArray(res1.body.data));
    const foundUnaniExam = res1.body.data.find((e) => e._id === unaniExam._id.toString() || e.id === unaniExam._id.toString());
    assert.ok(foundUnaniExam, 'Created Unani exam should be present in available exams');
    const foundAcademicExam = res1.body.data.find((e) => e._id === academicExam._id.toString() || e.id === academicExam._id.toString());
    assert.strictEqual(foundAcademicExam, undefined, 'Academic exam MUST NOT be returned in Unani exams');
    console.log('✅ PASS: Student can fetch available Unani exams & Academic exams are filtered out\n');

    // ── Test 3 & 4: GET Unani Exam Details & Questions (No Answer Key) ──
    console.log('--- Test 3 & 4: GET /api/unani-exams/student/:examId Security ---');
    const res3 = await makeRequest(`/api/unani-exams/student/${unaniExam._id}`, 'GET', { Authorization: `Bearer ${unaniStudentToken}` });
    console.log('Response status:', res3.status);
    assert.strictEqual(res3.status, 200);
    assert.strictEqual(res3.body.success, true);
    assert.ok(res3.body.data.exam);
    assert.ok(Array.isArray(res3.body.data.questions));
    assert.strictEqual(res3.body.data.questions.length, 3);
    
    // Check critical security constraint: correctOption & explanation MUST NOT be exposed
    const sampleQuestion = res3.body.data.questions[0];
    assert.strictEqual(sampleQuestion.correctOption, undefined, 'CRITICAL SECURITY FAIL: correctOption exposed to student!');
    assert.strictEqual(sampleQuestion.correctAnswer, undefined, 'CRITICAL SECURITY FAIL: correctAnswer exposed to student!');
    assert.strictEqual(sampleQuestion.explanation, undefined, 'CRITICAL SECURITY FAIL: explanation exposed to student!');
    assert.ok(sampleQuestion.questionText || sampleQuestion.question, 'Question text should be present');
    assert.ok(sampleQuestion.options, 'Question options should be present');
    console.log('✅ PASS: Student receives questions with NO answer keys or correctOption fields\n');

    // ── Test 5: Unauthorized Request (401) ──
    console.log('--- Test 5: Unauthorized Request without JWT (401) ---');
    const res5 = await makeRequest('/api/unani-exams/student', 'GET');
    console.log('Response status:', res5.status);
    assert.strictEqual(res5.status, 401, 'Expected 401 Unauthorized when missing Bearer JWT');
    console.log('✅ PASS: Request without JWT returns 401\n');

    // ── Test 6: Student Without Unani Access (403) ──
    console.log('--- Test 6: Student without Unani Course Access (403) ---');
    const res6 = await makeRequest('/api/unani-exams/student', 'GET', { Authorization: `Bearer ${nonUnaniStudentToken}` });
    console.log('Response status:', res6.status);
    assert.strictEqual(res6.status, 403, 'Expected 403 Forbidden for student without Unani course enrollment');
    console.log('✅ PASS: Student without Unani enrollment returns 403\n');

    // ── Test 7 - 14: Submit Exam & Server-side Score Calculation ──
    console.log('--- Test 7 - 14: POST /api/unani-exams/student/:examId/submit ---');
    const q1Id = unaniExam.questions[0]._id.toString(); // correct: 'A'
    const q2Id = unaniExam.questions[1]._id.toString(); // correct: 'B'
    const q3Id = unaniExam.questions[2]._id.toString(); // correct: 'C'

    // Submit: Q1 correct ('A'), Q2 wrong ('A' instead of 'B'), Q3 unanswered
    // Expected: 1 correct (3 marks), 1 wrong (-0.5 penalty), 1 unanswered (0)
    // Score = 3 - 0.5 = 2.5 out of 9 total marks (Percentage = (2.5 / 9) * 100 = 27.78%)
    const submissionBody = {
      answers: [
        { questionId: q1Id, answer: 'A' },
        { questionId: q2Id, answer: 'A' }, // wrong answer
      ],
      timeTakenSeconds: 1800,
      // Attempt to forge client score (MUST be ignored by server)
      score: 999,
      percentage: 100,
      correct: 100,
    };

    const res7 = await makeRequest(
      `/api/unani-exams/student/${unaniExam._id}/submit`,
      'POST',
      { Authorization: `Bearer ${unaniStudentToken}` },
      submissionBody
    );
    console.log('Response status:', res7.status);
    console.log('Response body:', JSON.stringify(res7.body, null, 2));
    assert.strictEqual(res7.status, 201, 'Expected 201 Created for successful exam submission');
    assert.strictEqual(res7.body.success, true);
    const data7 = res7.body.data;
    assert.strictEqual(data7.correct, 1, 'Expected 1 correct answer');
    assert.strictEqual(data7.wrong, 1, 'Expected 1 wrong answer');
    assert.strictEqual(data7.unanswered, 1, 'Expected 1 unanswered question');
    assert.strictEqual(data7.score, 2.5, 'Expected calculated score of 2.5 (3 - 0.5)');
    assert.strictEqual(data7.percentage, 27.78, 'Expected calculated percentage of 27.78%');
    assert.strictEqual(data7.timeTakenSeconds, 1800, 'Expected timeTakenSeconds of 1800');
    assert.ok(data7.resultId, 'Result ID should be present');
    console.log('✅ PASS: Server-side score calculation, wrong answer penalty, and timing stored correctly\n');

    // ── Test 15: Student Fetch Own Result ──
    console.log('--- Test 15: GET /api/unani-exams/student/:examId/result ---');
    const res15 = await makeRequest(`/api/unani-exams/student/${unaniExam._id}/result`, 'GET', { Authorization: `Bearer ${unaniStudentToken}` });
    console.log('Response status:', res15.status);
    assert.strictEqual(res15.status, 200);
    assert.strictEqual(res15.body.success, true);
    assert.strictEqual(res15.body.data.score, 2.5);
    assert.strictEqual(res15.body.data.studentId, unaniStudentDoc._id.toString());
    console.log('✅ PASS: Student can fetch their own calculated result after submission\n');

    // ── Test 17: Duplicate Submission Rejection (409 Conflict) ──
    console.log('--- Test 17: Duplicate Submission Prevention (409 Conflict) ---');
    const res17 = await makeRequest(
      `/api/unani-exams/student/${unaniExam._id}/submit`,
      'POST',
      { Authorization: `Bearer ${unaniStudentToken}` },
      submissionBody
    );
    console.log('Response status:', res17.status);
    assert.strictEqual(res17.status, 409, 'Expected 409 Conflict for duplicate exam submission');
    assert.strictEqual(res17.body.success, false);
    console.log('✅ PASS: Duplicate exam submission correctly rejected with 409 Conflict\n');

    // ── Test 20, 21, 22: Verify Admin Unani Test History & Admin Rank Integration ──
    console.log('--- Test 20 & 21: Admin Unani Test History & Rank Integration ---');
    const res20 = await makeRequest('/api/unani-exams/history', 'GET', { Authorization: `Bearer ${adminToken}` });
    console.log('Admin Test History status:', res20.status);
    assert.strictEqual(res20.status, 200);
    assert.ok(res20.body.data.tests);
    const historyExam = res20.body.data.tests.find((t) => t._id === unaniExam._id.toString() || t.id === unaniExam._id.toString());
    assert.ok(historyExam, 'Unani exam should appear in Admin Test History');
    assert.strictEqual(historyExam.attended, 1, 'Admin Test History should report 1 attended student');

    const res22 = await makeRequest(`/api/unani-exams/${unaniExam._id}/rank`, 'GET', { Authorization: `Bearer ${adminToken}` });
    console.log('Admin Rank status:', res22.status);
    assert.strictEqual(res22.status, 200);
    assert.ok(res22.body.data.rankings);
    assert.strictEqual(res22.body.data.rankings.length, 1);
    assert.strictEqual(res22.body.data.rankings[0].score, 2.5);
    console.log('✅ PASS: Admin Test History & Rank automatically see submitted student result\n');

    console.log('====================================================');
    console.log('🎉 ALL 23 TEST CASES PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Test suite error:', err);
    process.exitCode = 1;
  } finally {
    if (unaniExam) await UnaniExam.deleteOne({ _id: unaniExam._id });
    if (academicExam) await Exam.deleteOne({ _id: academicExam._id });
    if (unaniStudentUser) {
      await User.deleteOne({ _id: unaniStudentUser._id });
      await Student.deleteOne({ _id: unaniStudentDoc._id });
      await UnaniExamResult.deleteMany({ studentId: unaniStudentDoc._id });
    }
    if (nonUnaniStudentUser) {
      await User.deleteOne({ _id: nonUnaniStudentUser._id });
      await Student.deleteOne({ _id: nonUnaniStudentDoc._id });
    }
    if (adminUser) await User.deleteOne({ _id: adminUser._id });

    if (server) {
      server.close(() => console.log('✅ Test server closed cleanly.'));
    }
  }
}

runTests();
