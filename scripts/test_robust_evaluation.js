require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Exam = require('../models/exam.model');
const studentController = require('../src/student/student.controller');
const TestResult = require('../src/common/models/testResult.model');

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

async function runRobustEvaluationTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING ROBUST EXAM EVALUATION & NEGATIVE MARKING TESTS');
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

  try {
    console.log('📝 Creating test exam with 4 questions and negative mark 0.5...');
    const exam = await Exam.create({
      title: `Robust Evaluation Test ${timestamp}`,
      marksPerQuestion: 2,
      negativeMark: 0.5,
      negativeMarkPenalty: 0.5,
      durationMinutes: 45,
      totalQuestions: 4,
      questions: [
        {
          questionText: 'What is the fundamental law of homeopathy?',
          options: {
            A: 'Similia Similibus Curentur',
            B: 'Contraria Contrariis Curentur',
            C: 'Law of Mass Action',
            D: 'Single Dose Law'
          },
          correctOption: 'A'
        },
        {
          questionText: 'Who discovered homeopathy?',
          options: {
            A: 'Hippocrates',
            B: 'Samuel Hahnemann',
            C: 'James Tyler Kent',
            D: 'William Boericke'
          },
          correctOption: 'B' // Enum value 'B'
        },
        {
          questionText: 'Which remedy is derived from honey bee?',
          options: {
            A: 'Belladonna',
            B: 'Arnica',
            C: 'Apis Mellifica',
            D: 'Aconite'
          },
          correctOption: 'C'
        },
        {
          questionText: 'What is the potency of 30C?',
          options: {
            A: 'Centesimal 30th',
            B: 'Decimal 30th',
            C: '50 Millesimal 30th',
            D: 'Mother Tincture'
          },
          correctOption: 'A'
        }
      ]
    });

    const q1 = exam.questions[0];
    const q2 = exam.questions[1];
    const q3 = exam.questions[2];
    const q4 = exam.questions[3];

    const fakeStudentId = new mongoose.Types.ObjectId();

    console.log('\n--- Test 1: Robust Option Format Variations (All Correct Inputs) ---');
    {
      const req = {
        params: { id: exam._id.toString() },
        user: { id: fakeStudentId },
        body: {
          answers: [
            { questionId: q1._id, selectedOption: '  a  ' },                      // Q1: lowercase & whitespace -> A
            { questionId: q2._id, selectedOption: 'Option B' },                   // Q2: prefix "Option B" -> B
            { questionId: q3._id, selectedOption: 'Apis Mellifica' },              // Q3: full option text -> C
            { questionId: q4._id, selectedOption: 0 }                             // Q4: numeric index 0 -> A
          ]
        }
      };
      const res = mockRes();
      await studentController.submitExam(req, res);

      assert('Status code is 201 Created', res.statusCode === 201);
      assert('4 out of 4 correct answers identified', res.body.data.correctAnswers === 4);
      assert('0 wrong answers', res.body.data.wrongAnswers === 0);
      assert('Positive marks = 8 (4 * 2)', res.body.data.positiveMarks === 8);
      assert('Negative marks = 0', res.body.data.negativeMarks === 0);
      assert('Final score = 8', res.body.data.finalScore === 8);
      assert('Percentage = 100%', res.body.data.percentage === 100);

      if (res.body.data._id) await TestResult.findByIdAndDelete(res.body.data._id);
    }

    console.log('\n--- Test 2: Negative Marking Calculation (2 Correct, 2 Wrong) ---');
    {
      // Correct marks per question = 2
      // Penalty per wrong answer = 0.5
      // 2 Correct = +4 marks, 2 Wrong = -1.0 mark => Final score = 3.0
      const req = {
        params: { id: exam._id.toString() },
        user: { id: fakeStudentId },
        body: {
          answers: [
            { questionId: q1._id, selectedOption: 'A)' },                        // Q1: Correct (+2)
            { questionId: q2._id, selectedOption: 'Option A' },                   // Q2: Wrong (-0.5)
            { questionId: q3._id, selectedOption: 'C.' },                        // Q3: Correct (+2)
            { questionId: q4._id, selectedOption: 'D' }                          // Q4: Wrong (-0.5)
          ]
        }
      };
      const res = mockRes();
      await studentController.submitExam(req, res);

      assert('Status code is 201 Created', res.statusCode === 201);
      assert('Correct answers count = 2', res.body.data.correctAnswers === 2);
      assert('Wrong answers count = 2', res.body.data.wrongAnswers === 2);
      assert('Positive marks = 4 (2 * 2)', res.body.data.positiveMarks === 4);
      assert('Negative marks = 1 (2 * 0.5)', res.body.data.negativeMarks === 1);
      assert('Final score = 3 (4 - 1)', res.body.data.finalScore === 3);
      assert('Percentage = 37.5% (3 / 8)', res.body.data.percentage === 37.5);

      // Verify MongoDB TestResult Persistence
      const savedResult = await TestResult.findById(res.body.data._id);
      assert('TestResult saved in MongoDB', savedResult !== null);
      assert('Saved score in DB matches 3', savedResult.score === 3);
      assert('Saved negativeMarks in DB matches 1', savedResult.negativeMarks === 1);
      assert('Saved positiveMarks in DB matches 4', savedResult.positiveMarks === 4);

      if (res.body.data._id) await TestResult.findByIdAndDelete(res.body.data._id);
    }

    console.log('\n--- Test 3: Unanswered / Partial Answers (1 Correct, 1 Wrong, 2 Unanswered) ---');
    {
      const req = {
        params: { id: exam._id.toString() },
        user: { id: fakeStudentId },
        body: {
          answers: [
            { questionId: q1._id, selectedOption: 'A' },                         // Q1: Correct (+2)
            { questionId: q2._id, selectedOption: 'D' },                         // Q2: Wrong (-0.5)
            { questionId: q3._id, selectedOption: '' },                          // Q3: Empty string (Unanswered)
            { questionId: q4._id, selectedOption: null }                        // Q4: Null (Unanswered)
          ]
        }
      };
      const res = mockRes();
      await studentController.submitExam(req, res);

      assert('Attempted questions = 2', res.body.data.attemptedQuestions === 2);
      assert('Unanswered questions = 2', res.body.data.unansweredQuestions === 2);
      assert('Correct answers = 1', res.body.data.correctAnswers === 1);
      assert('Wrong answers = 1', res.body.data.wrongAnswers === 1);
      assert('Positive marks = 2', res.body.data.positiveMarks === 2);
      assert('Negative marks = 0.5', res.body.data.negativeMarks === 0.5);
      assert('Final score = 1.5 (2 - 0.5)', res.body.data.finalScore === 1.5);

      if (res.body.data._id) await TestResult.findByIdAndDelete(res.body.data._id);
    }

    // Clean up created test exam
    await Exam.findByIdAndDelete(exam._id);
    console.log('\n🧹 Cleaned up test exam document.');

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

runRobustEvaluationTests();
