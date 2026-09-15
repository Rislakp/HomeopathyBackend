require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Exam = require('../src/common/models/exam.model');
const TestResult = require('../src/common/models/testResult.model');
const studentController = require('../src/student/student.controller');

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

async function runTest() {
  console.log('====================================================');
  console.log('🚀 RUNNING STUDENT RESULTS CORRECT OPTION VERIFICATION TEST');
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
      if (details) console.error(`     Details: ${JSON.stringify(details)}`);
      testsFailed++;
    }
  }

  const timestamp = Date.now();
  const fakeStudentId = new mongoose.Types.ObjectId();

  try {
    // 1. Create a test Exam
    console.log('📝 Creating test exam document...');
    const exam = await Exam.create({
      title: `Correct Option Test Exam ${timestamp}`,
      marksPerQuestion: 1,
      durationMinutes: 30,
      totalQuestions: 2,
      questions: [
        {
          questionText: 'What is remedy A?',
          options: { A: 'Apis', B: 'Arnica', C: 'Belladonna', D: 'Bryonia' },
          correctOption: 'B'
        },
        {
          questionText: 'What is remedy B?',
          options: { A: 'Calcarea', B: 'Carbo', C: 'Chamomilla', D: 'China' },
          correctOption: 'D'
        }
      ]
    });

    const q1 = exam.questions[0];
    const q2 = exam.questions[1];

    console.log('\n--- Test 1: POST /api/student/exams/:id/submit contains correctOption ---');
    {
      const req = {
        params: { id: exam._id.toString() },
        user: { id: fakeStudentId },
        body: {
          answers: [
            { questionId: q1._id, selectedOption: 'A' }, // Wrong (Selected A, Correct B)
            { questionId: q2._id, selectedOption: 'D' }  // Correct (Selected D, Correct D)
          ]
        }
      };
      const res = mockRes();
      await studentController.submitExam(req, res);

      assert('Status code is 201 Created', res.statusCode === 201);
      const answers = res.body?.data?.answers || [];
      assert('Answers array returned with 2 items', answers.length === 2);
      assert('Item 1 has correctOption "B"', answers[0]?.correctOption === 'B');
      assert('Item 1 isCorrect is false', answers[0]?.isCorrect === false);
      assert('Item 2 has correctOption "D"', answers[1]?.correctOption === 'D');
      assert('Item 2 isCorrect is true', answers[1]?.isCorrect === true);
    }

    console.log('\n--- Test 2: GET /api/student/results populates correctOption ---');
    {
      const req = {
        user: { id: fakeStudentId }
      };
      const res = mockRes();
      await studentController.getStudentResults(req, res);

      assert('Status code is 200 OK', res.statusCode === 200);
      assert('Data array returned with 1 result', res.body?.data?.length === 1);
      const result = res.body?.data?.[0];
      assert('Result contains answers array', Array.isArray(result?.answers));
      const answers = result?.answers || [];
      assert('Answers item 1 has selectedOption "A"', answers[0]?.selectedOption === 'A');
      assert('Answers item 1 has correctOption "B"', answers[0]?.correctOption === 'B');
      assert('Answers item 1 has isCorrect false', answers[0]?.isCorrect === false);
      assert('Answers item 2 has selectedOption "D"', answers[1]?.selectedOption === 'D');
      assert('Answers item 2 has correctOption "D"', answers[1]?.correctOption === 'D');
      assert('Answers item 2 has isCorrect true', answers[1]?.isCorrect === true);
    }

    console.log('\n--- Test 3: Legacy TestResult without correctOption saved in DB ---');
    {
      // Create a legacy result directly without correctOption field in answer items
      const legacyResult = await TestResult.create({
        studentId: fakeStudentId,
        examId: exam._id,
        score: 1,
        totalMarks: 2,
        totalAttempted: 2,
        totalCorrect: 1,
        totalWrong: 1,
        unansweredQuestions: 0,
        positiveMarks: 1,
        negativeMarks: 0,
        maximumScore: 2,
        percentage: 50,
        status: 'Completed',
        answers: [
          { questionId: q1._id, selectedOption: 'A', isCorrect: false },
          { questionId: q2._id, selectedOption: 'D', isCorrect: true }
        ]
      });

      const req = { user: { id: fakeStudentId } };
      const res = mockRes();
      await studentController.getStudentResults(req, res);

      const foundLegacy = res.body?.data?.find(r => r._id.toString() === legacyResult._id.toString());
      assert('Found legacy result in GET /api/student/results', foundLegacy !== undefined);
      const answers = foundLegacy?.answers || [];
      assert('Legacy answer 1 populated with correctOption "B"', answers[0]?.correctOption === 'B');
      assert('Legacy answer 2 populated with correctOption "D"', answers[1]?.correctOption === 'D');

      await TestResult.findByIdAndDelete(legacyResult._id);
    }

    // Clean up created test exam & results
    await TestResult.deleteMany({ studentId: fakeStudentId });
    await Exam.findByIdAndDelete(exam._id);
    console.log('\n🧹 Cleaned up test exam and test results.');

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

runTest();
