require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');
const Exam = require('../models/exam.model');
const Course = require('../models/Course');
const TestResult = require('../src/common/models/testResult.model');

const { getGrandMockById } = require('../controllers/exam.controller');
const { startExam, getStudentResults } = require('../src/student/student.controller');

async function runTests() {
  console.log('🧪 Starting Course/Module Exam Persistence & ImageUrl Test Suite...\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy';
  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB Connected');

  let testCourse = null;
  let createdExamId = null;
  let testResultDoc = null;

  try {
    // 1. Create a Test Course with a Module
    testCourse = await Course.create({
      courseTitle: 'Advanced Organon & Philosophy',
      instructor: 'Dr. Hahnemann',
      price: 4999,
      modules: [
        {
          moduleName: 'Module 1: Miasms and Chronic Diseases',
          lessons: []
        }
      ]
    });

    const testModule = testCourse.modules[0];
    console.log(`✅ Test Course Created (_id: ${testCourse._id}, module _id: ${testModule._id})`);

    // 2. Create Exam with courseId, moduleId, and question containing imageUrl
    const mockQuestion = {
      questionText: 'Identify the miasmatic state represented in the skin lesion diagram.',
      imageUrl: 'https://example.com/assets/miasm_skin_diagram.png',
      passage: 'A 35-year-old female presents with dry, scaly eruptions accompanied by intense itching at night.',
      options: {
        A: 'Psora',
        B: 'Sycosis',
        C: 'Syphilis',
        D: 'Tubercular'
      },
      correctOption: 'A'
    };

    const newExam = await Exam.create({
      title: 'Miasmatics Deep Dive Unit Test',
      testType: 'course_test',
      courseId: testCourse._id,
      moduleId: testModule._id,
      courseName: testCourse.courseTitle,
      moduleName: testModule.moduleName,
      marksPerQuestion: 2,
      negativeMark: 0.5,
      durationMinutes: 45,
      totalQuestions: 1,
      questions: [mockQuestion]
    });

    createdExamId = newExam._id;
    console.log(`✅ Exam Created (_id: ${createdExamId})`);
    assert.strictEqual(newExam.questions[0].imageUrl, 'https://example.com/assets/miasm_skin_diagram.png');
    console.log('   -> Verified question imageUrl persisted in DB schema correctly.');

    // 3. Test getGrandMockById controller output (Admin / General endpoint)
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

    await getGrandMockById({ params: { id: createdExamId.toString() } }, mockRes1);
    assert.strictEqual(mockRes1.statusCode, 200);
    assert.strictEqual(mockRes1.data.success, true);
    const examData1 = mockRes1.data.data;
    assert.strictEqual(examData1.courseName, 'Advanced Organon & Philosophy');
    assert.strictEqual(examData1.moduleName, 'Module 1: Miasms and Chronic Diseases');
    assert.strictEqual(examData1.questions[0].imageUrl, 'https://example.com/assets/miasm_skin_diagram.png');
    console.log('✅ getGrandMockById returned courseName, moduleName, and question imageUrl successfully.');

    // 4. Test startExam controller output (Student endpoint - anti-cheat sanitized)
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

    await startExam({ params: { id: createdExamId.toString() } }, mockRes2);
    assert.strictEqual(mockRes2.statusCode, 200);
    assert.strictEqual(mockRes2.data.success, true);
    const examData2 = mockRes2.data.data;
    assert.strictEqual(examData2.courseName, 'Advanced Organon & Philosophy');
    assert.strictEqual(examData2.moduleName, 'Module 1: Miasms and Chronic Diseases');
    assert.strictEqual(examData2.questions[0].imageUrl, 'https://example.com/assets/miasm_skin_diagram.png');
    assert.strictEqual(examData2.questions[0].correctOption, undefined, 'correctOption must be anti-cheat sanitized');
    console.log('✅ startExam returned populated courseName, moduleName, and question imageUrl (without correctOption).');

    // 5. Create TestResult and test getStudentResults controller output (View Test History)
    const dummyStudentId = new mongoose.Types.ObjectId();
    testResultDoc = await TestResult.create({
      studentId: dummyStudentId,
      examId: createdExamId,
      score: 2,
      totalMarks: 2,
      totalQuestions: 1,
      attemptedCount: 1,
      correctCount: 1,
      wrongCount: 0,
      accuracyPercentage: 100,
      answers: [
        {
          questionId: newExam.questions[0]._id,
          selectedOption: 'A',
          correctOption: 'A',
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
    assert.strictEqual(historyItem.examId.courseName, 'Advanced Organon & Philosophy');
    assert.strictEqual(historyItem.examId.moduleName, 'Module 1: Miasms and Chronic Diseases');
    console.log('✅ getStudentResults returned courseName and moduleName on populated examId in test history.');

    console.log('\n🎉 ALL PERSISTENCE AND POPULATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up created test documents
    console.log('🧹 Cleaning up test documents...');
    if (createdExamId) await Exam.findByIdAndDelete(createdExamId);
    if (testCourse) await Course.findByIdAndDelete(testCourse._id);
    if (testResultDoc) await TestResult.findByIdAndDelete(testResultDoc._id);
    console.log('✅ Test documents cleaned up.');
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

runTests();
