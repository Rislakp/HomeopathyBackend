require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');
const Exam = require('../models/exam.model');
const Course = require('../models/Course');
const TestResult = require('../src/common/models/testResult.model');

const { getGrandMockById } = require('../controllers/exam.controller');
const { startExam, getStudentResults } = require('../src/student/student.controller');

async function runTests() {
  console.log('🧪 Starting Course/Module Exam Persistence & Custom String ID Test Suite...\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy';
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB Connected');

  const testCourseIdString = `CRS-TEST-${Date.now()}`;
  let testCourse = null;
  let examObjectId = null;
  let examStringId = null;
  let testResultDoc = null;

  try {
    // 1. Create a Test Course with a custom courseId ("CRS-TEST-xxxx")
    testCourse = await Course.create({
      courseId: testCourseIdString,
      courseTitle: 'Homeopathic Pharmacy & Pharmacopoeia',
      instructor: 'Dr. Hahnemann',
      price: 2999,
      modules: [
        {
          moduleName: 'Module 1: Preparation of Potencies',
          lessons: []
        }
      ]
    });

    const testModule = testCourse.modules[0];
    console.log(`✅ Test Course Created (_id: ${testCourse._id}, courseId: "${testCourse.courseId}")`);

    // 2. Test saving Exam with custom string courseId ("CRS-TEST-xxxx") - MUST NOT throw BSON CastError!
    const mockQuestion = {
      questionText: 'What scale is used for decimal potencies?',
      imageUrl: 'https://example.com/assets/decimal_scale.png',
      options: {
        A: 'Centesimal (C)',
        B: 'Decimal (X or D)',
        C: '50 Millesimal (LM)',
        D: 'Korsakovian (K)'
      },
      correctOption: 'B'
    };

    const examWithCustomStringId = await Exam.create({
      title: 'Pharmacopoeia Unit Test (String Course ID)',
      testType: 'course_test',
      courseId: testCourseIdString, // Custom String ID matching frontend dropdown
      moduleId: testModule._id.toString(),
      marksPerQuestion: 2,
      negativeMark: 0,
      durationMinutes: 30,
      totalQuestions: 1,
      questions: [mockQuestion]
    });

    examStringId = examWithCustomStringId._id;
    console.log(`✅ Exam saved with custom string courseId ("${testCourseIdString}") without BSON CastError! (_id: ${examStringId})`);
    assert.strictEqual(examWithCustomStringId.courseId, testCourseIdString);

    // 3. Test getGrandMockById controller output for exam with String courseId
    const mockRes1 = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      }
    };

    await getGrandMockById({ params: { id: examStringId.toString() } }, mockRes1);
    assert.strictEqual(mockRes1.statusCode, 200);
    assert.strictEqual(mockRes1.data.success, true);
    const examData1 = mockRes1.data.data;
    assert.strictEqual(examData1.courseId, testCourseIdString);
    assert.strictEqual(examData1.courseName, 'Homeopathic Pharmacy & Pharmacopoeia');
    assert.strictEqual(examData1.moduleName, 'Module 1: Preparation of Potencies');
    console.log(`✅ getGrandMockById resolved courseName and moduleName for custom string courseId ("${testCourseIdString}").`);

    // 4. Test saving Exam with MongoDB ObjectId string courseId
    const examWithObjId = await Exam.create({
      title: 'Pharmacopoeia Unit Test (ObjectId Course ID)',
      testType: 'course_test',
      courseId: testCourse._id.toString(),
      moduleId: testModule._id.toString(),
      marksPerQuestion: 2,
      negativeMark: 0,
      durationMinutes: 30,
      totalQuestions: 1,
      questions: [mockQuestion]
    });

    examObjectId = examWithObjId._id;
    console.log(`✅ Exam saved with MongoDB ObjectId string courseId (_id: ${examObjectId})`);

    // 5. Test startExam controller output (Student endpoint - anti-cheat sanitized)
    const mockRes2 = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      }
    };

    await startExam({ params: { id: examStringId.toString() } }, mockRes2);
    assert.strictEqual(mockRes2.statusCode, 200);
    assert.strictEqual(mockRes2.data.success, true);
    const examData2 = mockRes2.data.data;
    assert.strictEqual(examData2.courseName, 'Homeopathic Pharmacy & Pharmacopoeia');
    assert.strictEqual(examData2.moduleName, 'Module 1: Preparation of Potencies');
    assert.strictEqual(examData2.questions[0].imageUrl, 'https://example.com/assets/decimal_scale.png');
    assert.strictEqual(examData2.questions[0].correctOption, undefined, 'correctOption must be anti-cheat sanitized');
    console.log('✅ startExam returned populated courseName & moduleName for custom string courseId.');

    // 6. Test getStudentResults controller output (View Test History)
    const dummyStudentId = new mongoose.Types.ObjectId();
    testResultDoc = await TestResult.create({
      studentId: dummyStudentId,
      examId: examStringId,
      score: 2,
      totalMarks: 2,
      totalQuestions: 1,
      attemptedCount: 1,
      correctCount: 1,
      wrongCount: 0,
      accuracyPercentage: 100,
      answers: [
        {
          questionId: examWithCustomStringId.questions[0]._id,
          selectedOption: 'B',
          correctOption: 'B',
          isCorrect: true
        }
      ]
    });

    const mockRes3 = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      }
    };

    await getStudentResults({ user: { id: dummyStudentId }, query: {} }, mockRes3);
    assert.strictEqual(mockRes3.statusCode, 200);
    assert.strictEqual(mockRes3.data.success, true);
    const historyItem = mockRes3.data.data[0];
    assert(historyItem.examId, 'Result must contain populated examId object');
    assert.strictEqual(historyItem.examId.courseName, 'Homeopathic Pharmacy & Pharmacopoeia');
    assert.strictEqual(historyItem.examId.moduleName, 'Module 1: Preparation of Potencies');
    console.log('✅ getStudentResults returned courseName and moduleName on populated examId in test history.');

    console.log('\n🎉 ALL CUSTOM STRING COURSE ID & PERSISTENCE TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up created test documents
    console.log('🧹 Cleaning up test documents...');
    if (examStringId) await Exam.findByIdAndDelete(examStringId);
    if (examObjectId) await Exam.findByIdAndDelete(examObjectId);
    if (testCourse) await Course.findByIdAndDelete(testCourse._id);
    if (testResultDoc) await TestResult.findByIdAndDelete(testResultDoc._id);
    console.log('✅ Test documents cleaned up.');
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

runTests();
