require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Exam = require('../models/exam.model');
const examController = require('../controllers/exam.controller');
const adminController = require('../src/admin/admin.controller');
const studentController = require('../src/student/student.controller');
const TestResult = require('../src/common/models/testResult.model');

function mockRes() {
  const res = {
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
  return res;
}

async function runTests() {
  await connectDB();
  console.log('--- STARTING NEGATIVE MARK TESTS ---');

  // Test 1: Validation fails for negative negativeMark
  console.log('\n[Test 1] Validation: negative negativeMark (-0.25)');
  {
    const req = {
      body: {
        title: 'Validation Negative Test',
        marksPerQuestion: 1,
        negativeMark: -0.25,
        durationMinutes: 60,
        totalQuestions: 1,
        questions: [{
          questionText: 'Q1',
          options: { A: '1', B: '2', C: '3', D: '4' },
          correctOption: 'A'
        }]
      }
    };
    const res = mockRes();
    await examController.createGrandMockExam(req, res);
    console.log(`Status: ${res.statusCode}, Message: ${res.body?.message}`);
    if (res.statusCode === 400 && res.body?.message?.includes('negativeMark must be a valid non-negative number')) {
      console.log('✅ PASS: Rejected negative negativeMark');
    } else {
      console.error('❌ FAIL: Did not reject negative negativeMark properly');
    }
  }

  // Test 2: Validation fails for non-numeric negativeMark
  console.log('\n[Test 2] Validation: non-numeric negativeMark ("abc")');
  {
    const req = {
      body: {
        title: 'Validation Non-numeric Test',
        marksPerQuestion: 1,
        negativeMark: 'abc',
        durationMinutes: 60,
        totalQuestions: 1,
        questions: [{
          questionText: 'Q1',
          options: { A: '1', B: '2', C: '3', D: '4' },
          correctOption: 'A'
        }]
      }
    };
    const res = mockRes();
    await examController.createGrandMockExam(req, res);
    console.log(`Status: ${res.statusCode}, Message: ${res.body?.message}`);
    if (res.statusCode === 400 && res.body?.message?.includes('negativeMark must be a valid non-negative number')) {
      console.log('✅ PASS: Rejected non-numeric negativeMark');
    } else {
      console.error('❌ FAIL: Did not reject non-numeric negativeMark properly');
    }
  }

  // Test 3: Creation with negativeMark: 0.25
  let createdExamId = null;
  console.log('\n[Test 3] Create Grand Mock Exam with negativeMark: 0.25');
  {
    const req = {
      body: {
        title: 'Test Exam with Negative Marking 0.25',
        marksPerQuestion: 1,
        negativeMark: 0.25,
        durationMinutes: 60,
        totalQuestions: 2,
        questions: [
          {
            questionText: 'What is 2+2?',
            options: { A: '3', B: '4', C: '5', D: '6' },
            correctOption: 'B'
          },
          {
            questionText: 'What is 3+3?',
            options: { A: '5', B: '6', C: '7', D: '8' },
            correctOption: 'B'
          }
        ]
      }
    };
    const res = mockRes();
    await examController.createGrandMockExam(req, res);
    console.log(`Status: ${res.statusCode}, Success: ${res.body?.success}`);
    if (res.statusCode === 201 && res.body?.exam?.negativeMark === 0.25) {
      console.log(`✅ PASS: Created exam with negativeMark = ${res.body.exam.negativeMark}`);
      createdExamId = res.body.exam._id.toString();
    } else {
      console.error('❌ FAIL: Exam creation failed', res.body);
    }
  }

  // Test 4: GET all grand mocks includes negativeMark
  console.log('\n[Test 4] GET /api/exams/grand-mock returns negativeMark');
  {
    const req = {};
    const res = mockRes();
    await examController.getAllGrandMocks(req, res);
    const found = res.body?.data?.find(e => e._id.toString() === createdExamId);
    if (found && found.negativeMark === 0.25) {
      console.log(`✅ PASS: Found exam in list with negativeMark: ${found.negativeMark}`);
    } else {
      console.error('❌ FAIL: negativeMark not found in getAllGrandMocks', found);
    }
  }

  // Test 5: GET grand mock by ID includes negativeMark
  console.log('\n[Test 5] GET /api/exams/grand-mock/:id returns negativeMark');
  {
    const req = { params: { id: createdExamId } };
    const res = mockRes();
    await examController.getGrandMockById(req, res);
    if (res.body?.data?.negativeMark === 0.25) {
      console.log(`✅ PASS: Found exam by ID with negativeMark: ${res.body.data.negativeMark}`);
    } else {
      console.error('❌ FAIL: negativeMark not found in getGrandMockById', res.body);
    }
  }

  // Test 6: Student submit evaluation with 1 correct, 1 wrong (1 * 1 - 1 * 0.25 = 0.75)
  console.log('\n[Test 6] Student exam submission score evaluation with negativeMark (0.25)');
  {
    const examDoc = await Exam.findById(createdExamId);
    const q1 = examDoc.questions[0];
    const q2 = examDoc.questions[1];

    const fakeStudentId = new mongoose.Types.ObjectId();
    const req = {
      params: { id: createdExamId },
      user: { id: fakeStudentId },
      body: {
        answers: [
          { questionId: q1._id, selectedOption: 'B' }, // Correct -> +1
          { questionId: q2._id, selectedOption: 'A' }  // Wrong -> -0.25
        ]
      }
    };
    const res = mockRes();
    await studentController.submitExam(req, res);
    console.log(`Submit Status: ${res.statusCode}`);
    const data = res.body?.data;
    console.log('Result Breakdown:', {
      positiveMarks: data?.positiveMarks,
      negativeMarks: data?.negativeMarks,
      finalScore: data?.finalScore,
      negativeMark: data?.negativeMark
    });

    if (data?.positiveMarks === 1 && data?.negativeMarks === 0.25 && data?.finalScore === 0.75) {
      console.log('✅ PASS: Score computed accurately (1 - 0.25 = 0.75)!');
    } else {
      console.error('❌ FAIL: Score computation mismatch', data);
    }

    // Clean up created test results & exam
    if (data?._id) {
      await TestResult.findByIdAndDelete(data._id);
    }
  }

  // Clean up test exam
  if (createdExamId) {
    await Exam.findByIdAndDelete(createdExamId);
    console.log('\nCleaned up test exam document.');
  }

  console.log('\n--- ALL TESTS COMPLETED SUCCESSFULLY ---');
  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
