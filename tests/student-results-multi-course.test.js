const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Student = require('../models/Student');
const User = require('../models/User');
const Course = require('../models/Course');
const TestResult = require('../src/common/models/testResult.model');
const { getStudentResults } = require('../src/student/student.controller');

const COURSE_1 = 'CRS-000069';
const COURSE_2 = 'CRS-000066';
const COURSE_OTHER = 'CRS-000099';
const SINGLE_COURSE = 'CRS-000080';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function mockQuery(doc) {
  const q = Promise.resolve(doc);
  q.select = () => q;
  q.populate = () => q;
  q.sort = () => q;
  q.skip = () => q;
  q.limit = () => q;
  q.lean = async () => doc;
  return q;
}

function setupMockEnvironment(mockStudent, mockResults, count = null) {
  const original = {
    TestResultCount: TestResult.countDocuments,
    TestResultFind: TestResult.find,
    StudentFindById: Student.findById,
    StudentFindOne: Student.findOne,
    StudentFind: Student.find,
    UserFindById: User.findById,
    UserFindOne: User.findOne,
    UserFind: User.find,
    CourseFind: Course.find,
    CourseFindOne: Course.findOne,
  };

  const resultsList = Array.isArray(mockResults) ? mockResults : [mockResults];
  const totalCount = count !== null ? count : resultsList.length;

  TestResult.countDocuments = async () => totalCount;
  TestResult.find = () => {
    const q = {
      populate(path, projection) {
        assert.ok(projection.includes('courseIds'));
        assert.ok(projection.includes('courses'));
        assert.ok(projection.includes('assignedCourses'));
        assert.ok(projection.includes('assignedCourseIds'));
        return q;
      },
      sort() { return q; },
      skip() { return q; },
      limit() { return q; },
      lean: async () => resultsList,
    };
    return q;
  };

  Student.findById = () => mockQuery(mockStudent);
  Student.findOne = () => mockQuery(mockStudent);
  Student.find = () => mockQuery([mockStudent]);

  User.findById = () => mockQuery(null);
  User.findOne = () => mockQuery(null);
  User.find = () => mockQuery([]);

  Course.find = () => mockQuery([]);
  Course.findOne = () => mockQuery(null);

  return () => {
    TestResult.countDocuments = original.TestResultCount;
    TestResult.find = original.TestResultFind;
    Student.findById = original.StudentFindById;
    Student.findOne = original.StudentFindOne;
    Student.find = original.StudentFind;
    User.findById = original.UserFindById;
    User.findOne = original.UserFindOne;
    User.find = original.UserFind;
    Course.find = original.CourseFind;
    Course.findOne = original.CourseFindOne;
  };
}

test('Multi-Course Results Regression: Student enrolled in CRS-000066 can retrieve results for exam assigned to CRS-000069 and CRS-000066', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const resultId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'MM WEEKLY EXAM',
    testType: 'course_test',
    courseId: COURSE_1,
    courseIds: [COURSE_1, COURSE_2],
    questions: [
      {
        _id: new mongoose.Types.ObjectId(),
        questionText: 'CONSTANTLY THEORISING',
        options: { A: 'cannabis sativa', B: 'cannabis indica', C: 'calcarea carb', D: 'carbo animalis' },
        correctOption: 'B',
      }
    ],
    marksPerQuestion: 4,
    negativeMark: 1,
    totalQuestions: 1,
    durationMinutes: 60,
  };

  const mockResult = {
    _id: resultId,
    studentId,
    examId: mockExam,
    score: 4,
    totalMarks: 4,
    totalAttempted: 1,
    totalCorrect: 1,
    totalWrong: 0,
    unansweredQuestions: 0,
    status: 'Completed',
    attemptNumber: 1,
    createdAt: new Date(),
    answers: [
      {
        questionId: mockExam.questions[0]._id,
        selectedOption: 'B',
        correctOption: 'B',
        isCorrect: true,
        status: 'correct',
      }
    ]
  };

  const mockStudent = {
    _id: studentId,
    userId: studentId,
    email: 'enrolled66@test.com',
    courseIds: [COURSE_2],
  };

  const restore = setupMockEnvironment(mockStudent, [mockResult]);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'enrolled66@test.com' },
      query: {},
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.data[0]._id.toString(), resultId.toString());
    assert.equal(res.body.data[0].examId._id.toString(), examId.toString());
    assert.equal(res.body.data[0].examId.title, 'MM WEEKLY EXAM');
    assert.equal(res.body.data[0].answers[0].isCorrect, true);
    assert.equal(res.body.data[0].answers[0].status, 'correct');
  } finally {
    restore();
  }
});

test('Multi-Course Results Regression: Student enrolled in CRS-000069 can also retrieve the same exam result', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const resultId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'MM WEEKLY EXAM',
    testType: 'course_test',
    courseId: COURSE_1,
    courseIds: [COURSE_1, COURSE_2],
    questions: [],
    marksPerQuestion: 4,
    negativeMark: 1,
    totalQuestions: 1,
    durationMinutes: 60,
  };

  const mockResult = {
    _id: resultId,
    studentId,
    examId: mockExam,
    score: 4,
    status: 'Completed',
    attemptNumber: 1,
    createdAt: new Date(),
    answers: []
  };

  const mockStudent = {
    _id: studentId,
    userId: studentId,
    email: 'enrolled69@test.com',
    courseIds: [COURSE_1],
  };

  const restore = setupMockEnvironment(mockStudent, [mockResult]);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'enrolled69@test.com' },
      query: {},
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.data[0]._id.toString(), resultId.toString());
  } finally {
    restore();
  }
});

test('Multi-Course Results Regression: Student enrolled in neither course cannot retrieve the result', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const resultId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'MM WEEKLY EXAM',
    testType: 'course_test',
    courseId: COURSE_1,
    courseIds: [COURSE_1, COURSE_2],
    questions: [],
    marksPerQuestion: 4,
    negativeMark: 1,
    totalQuestions: 1,
  };

  const mockResult = {
    _id: resultId,
    studentId,
    examId: mockExam,
    score: 4,
    status: 'Completed',
    attemptNumber: 1,
    createdAt: new Date(),
    answers: []
  };

  const mockStudent = {
    _id: studentId,
    userId: studentId,
    email: 'other@test.com',
    courseIds: [COURSE_OTHER],
  };

  const restore = setupMockEnvironment(mockStudent, [mockResult]);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'other@test.com' },
      query: {},
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.count, 0);
    assert.equal(res.body.data.length, 0);
  } finally {
    restore();
  }
});

test('Multi-Course Results Regression: Single-course exams continue working with single-course fallback', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const resultId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'SINGLE COURSE TEST',
    testType: 'course_test',
    courseId: SINGLE_COURSE,
    questions: [],
    marksPerQuestion: 2,
    totalQuestions: 1,
  };

  const mockResult = {
    _id: resultId,
    studentId,
    examId: mockExam,
    score: 2,
    status: 'Completed',
    attemptNumber: 1,
    createdAt: new Date(),
    answers: []
  };

  const mockStudentEnrolled = {
    _id: studentId,
    userId: studentId,
    email: 'enrolled_single@test.com',
    courseIds: [SINGLE_COURSE],
  };

  const restore = setupMockEnvironment(mockStudentEnrolled, [mockResult]);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'enrolled_single@test.com' },
      query: {},
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.data[0]._id.toString(), resultId.toString());
  } finally {
    restore();
  }
});

test('Multi-Course Results Regression: Grand Mock exams without course assignment preserve global visibility', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const resultId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'GRAND MOCK 2026',
    testType: 'grand_mock',
    courseId: null,
    courseIds: [],
    questions: [],
    marksPerQuestion: 1,
    totalQuestions: 100,
  };

  const mockResult = {
    _id: resultId,
    studentId,
    examId: mockExam,
    score: 80,
    status: 'Completed',
    attemptNumber: 1,
    createdAt: new Date(),
    answers: []
  };

  const mockStudent = {
    _id: studentId,
    userId: studentId,
    email: 'any_student@test.com',
    courseIds: [],
  };

  const restore = setupMockEnvironment(mockStudent, [mockResult]);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'any_student@test.com' },
      query: {},
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.data[0].examId.title, 'GRAND MOCK 2026');
  } finally {
    restore();
  }
});

test('Multi-Course Results Regression: Multiple results from different exams return with their correct exam IDs and pagination', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const examId1 = new mongoose.Types.ObjectId();
  const examId2 = new mongoose.Types.ObjectId();
  const resultId1 = new mongoose.Types.ObjectId();
  const resultId2 = new mongoose.Types.ObjectId();

  const mockExam1 = {
    _id: examId1,
    title: 'MM WEEKLY EXAM',
    testType: 'course_test',
    courseId: COURSE_1,
    courseIds: [COURSE_1, COURSE_2],
    questions: [],
  };

  const mockExam2 = {
    _id: examId2,
    title: 'GENERAL GRAND MOCK',
    testType: 'grand_mock',
    courseId: null,
    questions: [],
  };

  const mockResults = [
    {
      _id: resultId1,
      studentId,
      examId: mockExam1,
      score: 6,
      status: 'Completed',
      attemptNumber: 1,
      createdAt: new Date('2026-11-02T10:00:00Z'),
      answers: []
    },
    {
      _id: resultId2,
      studentId,
      examId: mockExam2,
      score: 50,
      status: 'Completed',
      attemptNumber: 1,
      createdAt: new Date('2026-11-01T10:00:00Z'),
      answers: []
    }
  ];

  const mockStudent = {
    _id: studentId,
    userId: studentId,
    email: 'multi_exam@test.com',
    courseIds: [COURSE_2],
  };

  const restore = setupMockEnvironment(mockStudent, mockResults, 2);
  try {
    const req = {
      user: { id: studentId.toString(), studentId: studentId.toString(), role: 'student', email: 'multi_exam@test.com' },
      query: { page: '1', limit: '10' },
      originalUrl: '/api/student/results'
    };
    const res = responseRecorder();

    await getStudentResults(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.pagination.total, 2);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.limit, 10);
    assert.equal(res.body.data[0]._id.toString(), resultId1.toString());
    assert.equal(res.body.data[0].examId._id.toString(), examId1.toString());
    assert.equal(res.body.data[1]._id.toString(), resultId2.toString());
    assert.equal(res.body.data[1].examId._id.toString(), examId2.toString());
  } finally {
    restore();
  }
});
