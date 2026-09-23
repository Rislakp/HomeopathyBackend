require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Exam = require('../models/Exam');
const User = require('../models/User');
const Student = require('../models/Student');
const TestResult = require('../src/common/models/testResult.model');
const studentController = require('../src/student/student.controller');
const examController = require('../controllers/examController');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING GRAND MOCK ATTEMPT / COMPLETION STATUS TESTS');
  console.log('====================================================\n');

  await connectDB();

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      testsPassed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      if (details) console.error(`     Details:`, details);
      testsFailed++;
    }
  }

  const timestamp = Date.now();

  try {
    // 1. Create a Grand Mock Exam (demo testing)
    console.log('1️⃣ Creating Grand Mock Exam: "demo testing"...');
    const exam = await Exam.create({
      title: `demo testing ${timestamp}`,
      testType: 'grand_mock',
      courseId: null,
      marksPerQuestion: 2,
      negativeMark: 0.5,
      negativeMarkPenalty: 0.5,
      durationMinutes: 30,
      totalQuestions: 2,
      questions: [
        {
          questionText: 'What is remedy A?',
          options: { A: 'Aconite', B: 'Belladonna', C: 'Chamomilla', D: 'Drosera' },
          correctOption: 'A'
        },
        {
          questionText: 'What is remedy B?',
          options: { A: 'Aconite', B: 'Belladonna', C: 'Chamomilla', D: 'Drosera' },
          correctOption: 'B'
        }
      ]
    });

    // 2. Create Student S1 (User + Student documents with different _id)
    const s1User = await User.create({
      name: `Student S1 ${timestamp}`,
      email: `s1_${timestamp}@test.com`,
      password: 'hashedpassword',
      role: 'student'
    });
    const s1Student = await Student.create({
      userId: s1User._id,
      name: `Student S1 ${timestamp}`,
      email: `s1_${timestamp}@test.com`,
      status: 'Active',
      accountStatus: 'Approved'
    });

    // 3. Create Student S2 (User + Student documents - Never attempts)
    const s2User = await User.create({
      name: `Student S2 ${timestamp}`,
      email: `s2_${timestamp}@test.com`,
      password: 'hashedpassword',
      role: 'student'
    });
    const s2Student = await Student.create({
      userId: s2User._id,
      name: `Student S2 ${timestamp}`,
      email: `s2_${timestamp}@test.com`,
      status: 'Active',
      accountStatus: 'Approved'
    });

    const s1ReqUser = {
      id: s1User._id.toString(),
      userId: s1User._id.toString(),
      studentId: s1Student._id.toString(),
      email: s1User.email,
      role: 'student'
    };

    const s2ReqUser = {
      id: s2User._id.toString(),
      userId: s2User._id.toString(),
      studentId: s2Student._id.toString(),
      email: s2User.email,
      role: 'student'
    };

    // -------------------------------------------------------------
    // STEP 1: Before Attempting -> Expected: Not Started
    // -------------------------------------------------------------
    console.log('\n--- Step 1: Check Available Grand Mocks Before Attempting ---');
    {
      const req = { user: s1ReqUser, query: { testType: 'grand_mock' } };
      const res = mockRes();
      await studentController.getAvailableExams(req, res);

      assert('GET /api/student/exams returned 200', res.statusCode === 200);
      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Exam found in available list', !!targetExam);
      assert('Status is "Not Started"', targetExam.status === 'Not Started', targetExam.status);
      assert('AttemptStatus is "not_started"', targetExam.attemptStatus === 'not_started', targetExam.attemptStatus);
      assert('hasAttempted is false', targetExam.hasAttempted === false, targetExam.hasAttempted);
      assert('isCompleted is false', targetExam.isCompleted === false, targetExam.isCompleted);
      assert('previousScore is null', targetExam.previousScore === null, targetExam.previousScore);
    }
    {
      // Also test via getAllGrandMocks endpoint
      const req = { user: s1ReqUser, query: { testType: 'grand_mock' }, originalUrl: '/api/exams/grand-mock' };
      const res = mockRes();
      await examController.getAllGrandMocks(req, res);

      assert('GET /api/exams/grand-mock returned 200', res.statusCode === 200);
      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Status is "Not Started" on /api/exams/grand-mock', targetExam.status === 'Not Started', targetExam.status);
      assert('hasAttempted is false on /api/exams/grand-mock', targetExam.hasAttempted === false);
    }

    // -------------------------------------------------------------
    // STEP 2: Student S1 starts test -> Expected: In Progress / Started
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Student Starts Test ---');
    {
      const req = { params: { id: exam._id.toString() }, user: s1ReqUser };
      const res = mockRes();
      await studentController.startExam(req, res);

      assert('GET /api/student/exams/:id/start returned 200', res.statusCode === 200);
      assert('Questions sanitized (no correctOption)', res.body.data.questions.every(q => !q.correctOption));

      // Verify Available Grand Mocks shows In Progress
      const availReq = { user: s1ReqUser, query: { testType: 'grand_mock' } };
      const availRes = mockRes();
      await studentController.getAvailableExams(availReq, availRes);

      const targetExam = (availRes.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Status is "In Progress"', targetExam.status === 'In Progress', targetExam.status);
      assert('attemptStatus is "in_progress"', targetExam.attemptStatus === 'in_progress', targetExam.attemptStatus);
      assert('hasAttempted is true', targetExam.hasAttempted === true, targetExam.hasAttempted);
      assert('isCompleted is false', targetExam.isCompleted === false, targetExam.isCompleted);
      assert('previousScore is null while In Progress', targetExam.previousScore === null);
    }

    // -------------------------------------------------------------
    // STEP 3: Student S1 submits test -> Expected: Completed / Submitted
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Student Submits Test ---');
    {
      const q1 = exam.questions[0];
      const q2 = exam.questions[1];
      const req = {
        params: { id: exam._id.toString() },
        user: s1ReqUser,
        body: {
          answers: [
            { questionId: q1._id, selectedOption: 'A' }, // Correct (+2)
            { questionId: q2._id, selectedOption: 'B' }  // Correct (+2)
          ]
        }
      };
      const res = mockRes();
      await studentController.submitExam(req, res);

      assert('POST /api/student/exams/:id/submit returned 201', res.statusCode === 201);
      assert('Submit returned status "Completed"', res.body.data.status === 'Completed');
      assert('Final score is 4', res.body.data.finalScore === 4);
      assert('Percentage is 100', res.body.data.percentage === 100);
    }

    // -------------------------------------------------------------
    // STEP 4: Refresh Available Grand Mocks -> Expected: Still Completed
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Refresh Available Grand Mocks After Submit ---');
    let resultIdFromS1 = null;
    {
      const req = { user: s1ReqUser, query: { testType: 'grand_mock' } };
      const res = mockRes();
      await studentController.getAvailableExams(req, res);

      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Status is "Completed"', targetExam.status === 'Completed', targetExam.status);
      assert('attemptStatus is "completed"', targetExam.attemptStatus === 'completed', targetExam.attemptStatus);
      assert('hasAttempted is true', targetExam.hasAttempted === true);
      assert('isCompleted is true', targetExam.isCompleted === true);
      assert('previousScore is 4', targetExam.previousScore === 4, targetExam.previousScore);
      assert('resultId is present', !!targetExam.resultId);
      resultIdFromS1 = targetExam.resultId;
    }
    {
      // Also verify on /api/exams/grand-mock
      const req = { user: s1ReqUser, query: { testType: 'grand_mock' }, originalUrl: '/api/exams/grand-mock' };
      const res = mockRes();
      await examController.getAllGrandMocks(req, res);

      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Status is "Completed" on /api/exams/grand-mock', targetExam.status === 'Completed', targetExam.status);
      assert('previousScore is 4 on /api/exams/grand-mock', targetExam.previousScore === 4);
    }

    // -------------------------------------------------------------
    // STEP 5: Logout & Login Again (Simulate new token session) -> Expected: Still Completed
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Simulate Logout and Re-Login ---');
    {
      // New session object for same student S1
      const reLoggedInUser = {
        id: s1User._id.toString(),
        userId: s1User._id.toString(),
        studentId: s1Student._id.toString(),
        email: s1User.email,
        role: 'student'
      };
      const req = { user: reLoggedInUser, query: { testType: 'grand_mock' } };
      const res = mockRes();
      await studentController.getAvailableExams(req, res);

      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Status is still "Completed" after re-login', targetExam.status === 'Completed');
      assert('previousScore is still 4 after re-login', targetExam.previousScore === 4);
      assert('resultId matches original result', targetExam.resultId.toString() === resultIdFromS1.toString());
    }

    // -------------------------------------------------------------
    // STEP 6: Student S2 (Never attempted) -> Expected: Not Started
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Student S2 Isolation Check ---');
    {
      const req = { user: s2ReqUser, query: { testType: 'grand_mock' } };
      const res = mockRes();
      await studentController.getAvailableExams(req, res);

      const targetExam = (res.body.data || []).find(e => e._id.toString() === exam._id.toString());
      assert('Student S2 status is "Not Started"', targetExam.status === 'Not Started', targetExam.status);
      assert('Student S2 hasAttempted is false', targetExam.hasAttempted === false);
      assert('Student S2 isCompleted is false', targetExam.isCompleted === false);
      assert('Student S2 previousScore is null', targetExam.previousScore === null);
      assert('Student S2 resultId is null', targetExam.resultId === null);
    }

    // -------------------------------------------------------------
    // STEP 7: Check Result History Linking
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Check Result History Linking ---');
    {
      const req = { user: s1ReqUser, query: { testType: 'grand_mock' } };
      const res = mockRes();
      await studentController.getStudentResults(req, res);

      assert('GET /api/student/results returned 200', res.statusCode === 200);
      assert('Results array count >= 1', res.body.data && res.body.data.length >= 1);
      const historyItem = res.body.data.find(r => r.examId && (r.examId._id ? r.examId._id.toString() : r.examId.toString()) === exam._id.toString());
      assert('Result History contains submitted result', !!historyItem);
      assert('Result ID matches available mock resultId', historyItem._id.toString() === resultIdFromS1.toString());
      assert('Score in history matches 4', historyItem.score === 4);
    }

    // -------------------------------------------------------------
    // Cleanup test data
    // -------------------------------------------------------------
    console.log('\n🧹 Cleaning up test artifacts...');
    await Exam.findByIdAndDelete(exam._id);
    await User.findByIdAndDelete(s1User._id);
    await Student.findByIdAndDelete(s1Student._id);
    await User.findByIdAndDelete(s2User._id);
    await Student.findByIdAndDelete(s2Student._id);
    await TestResult.deleteMany({ examId: exam._id });
    console.log('Cleanup completed.');

    console.log('\n====================================================');
    console.log(`📊 TEST SUMMARY: Passed: ${testsPassed}, Failed: ${testsFailed}`);
    console.log('====================================================');

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Test execution error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
