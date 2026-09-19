require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const Exam = require('../models/Exam');
const Course = require('../models/Course');
const User = require('../models/User');
const { getAllGrandMocks, getGrandMockById } = require('../controllers/examController');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.data = body;
      return this;
    }
  };
}

async function runTests() {
  console.log('🧪 Starting Admin Exam Listing & Metadata Population Verification Test Suite...\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const timestamp = Date.now();
  let testCourse = null;
  let grandMockExam = null;
  let courseExam = null;
  let adminUser = null;

  try {
    // 1. Create a Test Course
    testCourse = await Course.create({
      courseId: `CRS-ADMIN-TEST-${timestamp}`,
      courseTitle: 'Materia Medica Advanced',
      instructor: 'Dr. Kent',
      price: 1999,
      modules: [
        {
          moduleName: 'Module 1: Polycrests',
          lessons: []
        }
      ]
    });
    const testModule = testCourse.modules[0];
    console.log(`✅ Test Course created: ${testCourse.courseTitle} (${testCourse.courseId})`);

    // 2. Create Admin user for authentication context
    adminUser = await User.create({
      name: 'Admin Test',
      email: `admin_test_${timestamp}@example.com`,
      password: 'hashedpassword',
      role: 'admin'
    });
    const adminReqUser = {
      id: adminUser._id.toString(),
      _id: adminUser._id,
      email: adminUser.email,
      role: 'admin'
    };

    // 3. Create a Grand Mock Exam
    grandMockExam = await Exam.create({
      title: `Grand Mock Test ${timestamp}`,
      testType: 'grand_mock',
      courseId: null,
      moduleId: null,
      courseName: null,
      moduleName: null,
      marksPerQuestion: 2,
      negativeMark: 0.5,
      durationMinutes: 120,
      totalQuestions: 2,
      questions: [
        {
          questionText: 'Which remedy is known as the homeopathic knife?',
          options: { A: 'Silicea', B: 'Hepar Sulph', C: 'Sulphur', D: 'Calcarea Carb' },
          correctOption: 'A'
        },
        {
          questionText: 'Aconite is indicated for:',
          options: { A: 'Gradual onset', B: 'Sudden onset from cold wind', C: 'Chronic grief', D: 'Suppression' },
          correctOption: 'B'
        }
      ]
    });
    console.log(`✅ Grand Mock created: "${grandMockExam.title}" (_id: ${grandMockExam._id})`);

    // 4. Create a Course Test (Course-based Test)
    courseExam = await Exam.create({
      title: `Polycrests Module Exam ${timestamp}`,
      testType: 'course_test',
      courseId: testCourse.courseId,
      moduleId: testModule._id.toString(),
      courseName: testCourse.courseTitle,
      moduleName: testModule.moduleName,
      marksPerQuestion: 4,
      negativeMark: 1,
      durationMinutes: 45,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'What is the characteristic mental state of Arsenicum Album?',
          options: { A: 'Restless anxiety with fear of death', B: 'Mild and yielding', C: 'Violent rage', D: 'Indifference' },
          correctOption: 'A'
        }
      ]
    });
    console.log(`✅ Course Test created: "${courseExam.title}" (_id: ${courseExam._id})`);

    // -------------------------------------------------------------
    // TEST 1: Admin calls GET /api/exams (Admin Test History)
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Admin calls GET /api/exams (Admin Test History Listing) ---');
    const mockResAdmin = createMockRes();
    const adminReq = {
      originalUrl: '/api/exams',
      baseUrl: '/api',
      path: '/exams',
      query: {},
      user: adminReqUser
    };

    await getAllGrandMocks(adminReq, mockResAdmin);
    assert.strictEqual(mockResAdmin.statusCode, 200, 'Status should be 200');
    assert.strictEqual(mockResAdmin.data.success, true, 'success should be true');
    assert.ok(Array.isArray(mockResAdmin.data.data), 'data should be an array');

    const returnedExams = mockResAdmin.data.data;
    console.log(`Total exams returned by GET /api/exams for Admin: ${returnedExams.length}`);

    // Verify BOTH exams exist in the response
    const foundGrandMock = returnedExams.find(e => e._id.toString() === grandMockExam._id.toString());
    const foundCourseTest = returnedExams.find(e => e._id.toString() === courseExam._id.toString());

    assert.ok(foundGrandMock, 'Grand Mock exam MUST be returned in GET /api/exams for Admin');
    assert.ok(foundCourseTest, 'Course Test exam MUST be returned in GET /api/exams for Admin');

    // Verify Grand Mock metadata
    assert.strictEqual(foundGrandMock.testType, 'grand_mock', 'Grand mock testType must be canonical grand_mock');
    assert.strictEqual(foundGrandMock.totalQuestions, 2, 'Grand mock totalQuestions must be 2');
    assert.strictEqual(foundGrandMock.marksPerQuestion, 2, 'marksPerQuestion must be preserved');
    assert.strictEqual(foundGrandMock.durationMinutes, 120, 'durationMinutes must be preserved');
    assert.strictEqual(foundGrandMock.courseId, null, 'Grand mock courseId should be null');

    // Verify Course Test metadata and population
    assert.strictEqual(foundCourseTest.testType, 'course_test', 'Course test testType must be canonical course_test');
    assert.strictEqual(foundCourseTest.courseId, testCourse.courseId, 'courseId must be populated');
    assert.strictEqual(foundCourseTest.courseName, 'Materia Medica Advanced', 'courseName must match courseTitle');
    assert.strictEqual(foundCourseTest.moduleId, testModule._id.toString(), 'moduleId must match module ObjectId');
    assert.strictEqual(foundCourseTest.moduleName, 'Module 1: Polycrests', 'moduleName must be populated');
    assert.strictEqual(foundCourseTest.totalQuestions, 1, 'totalQuestions must be 1');
    assert.strictEqual(foundCourseTest.marksPerQuestion, 4, 'marksPerQuestion must be 4');
    assert.strictEqual(foundCourseTest.durationMinutes, 45, 'durationMinutes must be 45');

    // Verify ExamSummaryModel isCourseTest compatibility:
    // clean == 'course_test' || clean == 'course' || (courseId != null && courseId.trim().isNotEmpty)
    const isGrandMockCourseTest = Boolean(foundGrandMock.testType === 'course_test' || foundGrandMock.testType === 'course' || (foundGrandMock.courseId && foundGrandMock.courseId.trim().length > 0));
    const isCourseTestCourseTest = Boolean(foundCourseTest.testType === 'course_test' || foundCourseTest.testType === 'course' || (foundCourseTest.courseId && foundCourseTest.courseId.trim().length > 0));

    assert.strictEqual(isGrandMockCourseTest, false, 'ExamSummaryModel must identify Grand Mock as grand mock (NOT course test)');
    assert.strictEqual(isCourseTestCourseTest, true, 'ExamSummaryModel must identify Course Test as course test');
    console.log('✅ PASS: GET /api/exams returns all exams (Grand Mocks & Course Tests) with full course metadata!');

    // -------------------------------------------------------------
    // TEST 2: Student calls GET /api/exams/grand-mock (Student portal grand mock listing)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Student calls GET /api/exams/grand-mock (Student portal grand mocks) ---');
    const Student = require('../models/Student');
    const studentUser = await User.create({
      name: 'Student Tester',
      email: `student_${timestamp}@example.com`,
      role: 'student',
      password: 'password123'
    });
    const studentProfile = await Student.create({
      userId: studentUser._id,
      name: 'Student Tester',
      email: studentUser.email,
      accountStatus: 'Approved',
      status: 'Active',
      courseRef: testCourse._id
    });

    const mockResStudent = createMockRes();
    const studentReq = {
      originalUrl: '/api/exams/grand-mock',
      baseUrl: '/api/exams',
      path: '/grand-mock',
      query: {},
      user: { role: 'student', studentId: studentProfile._id.toString(), id: studentProfile._id.toString(), email: studentUser.email }
    };

    await getAllGrandMocks(studentReq, mockResStudent);
    assert.strictEqual(mockResStudent.statusCode, 200);
    const studentExams = mockResStudent.data.data;
    const foundCourseTestInStudentMocks = studentExams.find(e => e._id.toString() === courseExam._id.toString());
    const foundGrandMockInStudentMocks = studentExams.find(e => e._id.toString() === grandMockExam._id.toString());

    assert.strictEqual(foundCourseTestInStudentMocks, undefined, 'Course tests must NOT appear in GET /api/exams/grand-mock');
    assert.ok(foundGrandMockInStudentMocks, 'Grand mock must appear in GET /api/exams/grand-mock');
    console.log('✅ PASS: GET /api/exams/grand-mock strictly separates grand mocks without course tests.');

    // Cleanup student tester
    await Student.findByIdAndDelete(studentProfile._id);
    await User.findByIdAndDelete(studentUser._id);

    // -------------------------------------------------------------
    // TEST 3: Calling GET /api/exams/:id for Course Test
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Admin calls GET /api/exams/:id for Course Test ---');
    const mockResDetail = createMockRes();
    const detailReq = {
      params: { id: courseExam._id.toString() },
      user: adminReqUser
    };

    await getGrandMockById(detailReq, mockResDetail);
    assert.strictEqual(mockResDetail.statusCode, 200);
    const examDetail = mockResDetail.data.data;
    assert.strictEqual(examDetail.testType, 'course_test');
    assert.strictEqual(examDetail.courseId, testCourse.courseId);
    assert.strictEqual(examDetail.courseName, 'Materia Medica Advanced');
    assert.strictEqual(examDetail.moduleName, 'Module 1: Polycrests');
    assert.strictEqual(examDetail.questions.length, 1);
    console.log('✅ PASS: GET /api/exams/:id returns full course metadata and questions for course test.');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🚀');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exitCode = 1;
  } finally {
    console.log('\n🧹 Cleaning up test documents...');
    if (grandMockExam) await Exam.findByIdAndDelete(grandMockExam._id);
    if (courseExam) await Exam.findByIdAndDelete(courseExam._id);
    if (testCourse) await Course.findByIdAndDelete(testCourse._id);
    if (adminUser) await User.findByIdAndDelete(adminUser._id);
    console.log('✅ Cleanup completed.');
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

runTests();
