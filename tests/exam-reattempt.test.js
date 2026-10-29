const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Exam = require('../models/Exam');
const Course = require('../models/Course');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');

const {
  getAvailableExams,
  startExam,
  submitExam,
  checkReattemptEligibility,
  getStudentResults,
} = require('../src/student/student.controller');

const { getAdminExamResults } = require('../controllers/examController');
const unaniExamService = require('../src/unani/exams/services/unaniExam.service');
const { computeExamAttemptMetrics } = require('../utils/examAttemptHelper');

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

function queryWith(data) {
  const chain = {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean() {
      return {
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        then(resolve, reject) { return Promise.resolve(data).then(resolve, reject); }
      };
    },
    then(resolve, reject) {
      return Promise.resolve(data).then(resolve, reject);
    }
  };
  return chain;
}

test('1. First attempt creation, evaluation and submission generates attemptNumber: 1 and metrics', async () => {
  const original = {
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    resultFindById: TestResult.findById,
    resultCreate: TestResult.create,
    resultFindOneAndUpdate: TestResult.findOneAndUpdate,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    examFindById: Exam.findById,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Biochemistry Mock Test',
    testType: 'grand_mock',
    marksPerQuestion: 4,
    negativeMark: 1,
    durationMinutes: 60,
    totalQuestions: 2,
    questions: [
      { _id: new mongoose.Types.ObjectId(), questionText: 'Q1', options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' }, correctOption: 'A' },
      { _id: new mongoose.Types.ObjectId(), questionText: 'Q2', options: { A: 'A2', B: 'B2', C: 'C2', D: 'D2' }, correctOption: 'B' }
    ]
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  let storedResults = [];

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);

    TestResult.countDocuments = async (filter = {}) => {
      if (filter.status) {
        return storedResults.filter(r => ['Completed', 'Attempted'].includes(r.status)).length;
      }
      return storedResults.length;
    };

    TestResult.find = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.status && typeof filter.status === 'object' && filter.status.$in) {
        filtered = filtered.filter(r => filter.status.$in.includes(r.status));
      }
      return queryWith(filtered);
    };

    TestResult.findOne = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.status === 'In Progress') {
        filtered = filtered.filter(r => r.status === 'In Progress');
      }
      return queryWith(filtered[0] || null);
    };

    TestResult.create = async (doc) => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      storedResults.push(created);
      return created;
    };

    TestResult.findOneAndUpdate = async (filter, update) => {
      const target = storedResults.find(r => r._id.toString() === filter._id.toString() && r.status === 'In Progress');
      if (!target) return null;
      Object.assign(target, update.$set, { updatedAt: new Date() });
      return target;
    };

    // Step A: Start Exam Attempt 1
    const startRes = responseRecorder();
    await startExam({ user, params: { id: examId.toString() } }, startRes);

    assert.equal(startRes.statusCode, 200);
    assert.equal(startRes.body.data.attemptNumber, 1);
    assert.equal(startRes.body.data.totalAttempts, 0);
    assert.equal(startRes.body.data.isReattempt, false);
    assert.equal(storedResults.length, 1);
    assert.equal(storedResults[0].status, 'In Progress');
    assert.equal(storedResults[0].attemptNumber, 1);

    // Step B: Submit Exam Attempt 1 (1 correct, 1 wrong: score = 4 - 1 = 3)
    const submitRes = responseRecorder();
    await submitExam({
      user,
      params: { id: examId.toString() },
      body: {
        answers: [
          { questionId: mockExam.questions[0]._id.toString(), selectedOption: 'A' }, // Correct (+4)
          { questionId: mockExam.questions[1]._id.toString(), selectedOption: 'C' }  // Wrong (-1)
        ]
      }
    }, submitRes);

    assert.equal(submitRes.statusCode, 201);
    assert.equal(submitRes.body.data.score, 3);
    assert.equal(submitRes.body.data.attemptNumber, 1);
    assert.equal(submitRes.body.data.totalAttempts, 1);
    assert.equal(submitRes.body.data.latestScore, 3);
    assert.equal(submitRes.body.data.bestScore, 3);
    assert.equal(storedResults[0].status, 'Completed');
    assert.equal(storedResults[0].score, 3);
  } finally {
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    TestResult.findById = original.resultFindById;
    TestResult.create = original.resultCreate;
    TestResult.findOneAndUpdate = original.resultFindOneAndUpdate;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Exam.findById = original.examFindById;
  }
});

test('2 & 3. Reattempt after completed exam creates a new isolated attempt record and preserves previous attempt', async () => {
  const original = {
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    resultFindById: TestResult.findById,
    resultCreate: TestResult.create,
    resultFindOneAndUpdate: TestResult.findOneAndUpdate,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    examFindById: Exam.findById,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Pathology Grand Mock',
    testType: 'grand_mock',
    marksPerQuestion: 4,
    negativeMark: 1,
    durationMinutes: 60,
    totalQuestions: 2,
    questions: [
      { _id: new mongoose.Types.ObjectId(), questionText: 'Q1', options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' }, correctOption: 'A' },
      { _id: new mongoose.Types.ObjectId(), questionText: 'Q2', options: { A: 'A2', B: 'B2', C: 'C2', D: 'D2' }, correctOption: 'B' }
    ]
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  // Previous attempt 1 already completed with score 3
  const attempt1Id = new mongoose.Types.ObjectId();
  let storedResults = [
    {
      _id: attempt1Id,
      studentId,
      examId,
      attemptNumber: 1,
      status: 'Completed',
      score: 3,
      totalMarks: 8,
      totalAttempted: 2,
      totalCorrect: 1,
      totalWrong: 1,
      unansweredQuestions: 0,
      answers: [
        { questionId: mockExam.questions[0]._id, selectedOption: 'A', isCorrect: true },
        { questionId: mockExam.questions[1]._id, selectedOption: 'C', isCorrect: false }
      ],
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(Date.now() - 3600000),
    }
  ];

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);

    TestResult.countDocuments = async (filter = {}) => {
      if (filter.status) {
        return storedResults.filter(r => ['Completed', 'Attempted'].includes(r.status)).length;
      }
      return storedResults.length;
    };

    TestResult.find = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.status && typeof filter.status === 'object' && filter.status.$in) {
        filtered = filtered.filter(r => filter.status.$in.includes(r.status));
      }
      filtered.sort((a, b) => b.createdAt - a.createdAt);
      return queryWith(filtered);
    };

    TestResult.findOne = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.status === 'In Progress') {
        filtered = filtered.filter(r => r.status === 'In Progress');
      }
      filtered.sort((a, b) => b.createdAt - a.createdAt);
      return queryWith(filtered[0] || null);
    };

    TestResult.create = async (doc) => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      storedResults.push(created);
      return created;
    };

    TestResult.findOneAndUpdate = async (filter, update) => {
      const target = storedResults.find(r => r._id.toString() === filter._id.toString() && r.status === 'In Progress');
      if (!target) return null;
      Object.assign(target, update.$set, { updatedAt: new Date() });
      return target;
    };

    // Step A: Start Reattempt (Attempt 2)
    const reattemptStartRes = responseRecorder();
    await startExam({ user, params: { id: examId.toString() } }, reattemptStartRes);

    assert.equal(reattemptStartRes.statusCode, 200);
    assert.equal(reattemptStartRes.body.data.attemptNumber, 2);
    assert.equal(reattemptStartRes.body.data.totalAttempts, 1);
    assert.equal(reattemptStartRes.body.data.isReattempt, true);
    assert.equal(storedResults.length, 2);

    // Verify Attempt 1 remains intact
    const attempt1Before = storedResults.find(r => r._id.toString() === attempt1Id.toString());
    assert.equal(attempt1Before.attemptNumber, 1);
    assert.equal(attempt1Before.score, 3);
    assert.equal(attempt1Before.status, 'Completed');

    // Step B: Submit Reattempt (Attempt 2) with perfect score (both correct: 4 + 4 = 8)
    const reattemptSubmitRes = responseRecorder();
    await submitExam({
      user,
      params: { id: examId.toString() },
      body: {
        answers: [
          { questionId: mockExam.questions[0]._id.toString(), selectedOption: 'A' }, // Correct (+4)
          { questionId: mockExam.questions[1]._id.toString(), selectedOption: 'B' }  // Correct (+4)
        ]
      }
    }, reattemptSubmitRes);

    assert.equal(reattemptSubmitRes.statusCode, 201);
    assert.equal(reattemptSubmitRes.body.data.score, 8);
    assert.equal(reattemptSubmitRes.body.data.attemptNumber, 2);
    assert.equal(reattemptSubmitRes.body.data.totalAttempts, 2);
    assert.equal(reattemptSubmitRes.body.data.latestScore, 8);
    assert.equal(reattemptSubmitRes.body.data.bestScore, 8);

    // Verify both attempt records exist independently
    assert.equal(storedResults.length, 2);
    const attempt1After = storedResults.find(r => r._id.toString() === attempt1Id.toString());
    const attempt2 = storedResults.find(r => r._id.toString() !== attempt1Id.toString());

    assert.equal(attempt1After.score, 3);
    assert.equal(attempt1After.attemptNumber, 1);
    assert.equal(attempt1After.answers[1].selectedOption, 'C');

    assert.equal(attempt2.score, 8);
    assert.equal(attempt2.attemptNumber, 2);
    assert.equal(attempt2.answers[1].selectedOption, 'B');
  } finally {
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    TestResult.findById = original.resultFindById;
    TestResult.create = original.resultCreate;
    TestResult.findOneAndUpdate = original.resultFindOneAndUpdate;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Exam.findById = original.examFindById;
  }
});

test('4 & 5. Latest Score and Best Score correctly computed when reattempt score is lower', () => {
  const mockExam = { marksPerQuestion: 1, totalQuestions: 100 };
  const completedAttempts = [
    { _id: new mongoose.Types.ObjectId(), attemptNumber: 2, score: 25, status: 'Completed', createdAt: new Date('2026-10-28T12:00:00Z') },
    { _id: new mongoose.Types.ObjectId(), attemptNumber: 1, score: 75, status: 'Completed', createdAt: new Date('2026-10-28T10:00:00Z') }
  ];

  const metrics = computeExamAttemptMetrics(mockExam, completedAttempts);

  assert.equal(metrics.totalAttempts, 2);
  assert.equal(metrics.attempts, 2);
  assert.equal(metrics.latestScore, 25);
  assert.equal(metrics.bestScore, 75);
  assert.equal(metrics.isCompleted, true);
});

test('6. Idempotent submission: rapid double submit returns existing result without creating duplicate', async () => {
  const original = {
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    resultCreate: TestResult.create,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    examFindById: Exam.findById,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Anatomy Grand Mock',
    marksPerQuestion: 1,
    questions: [{ _id: new mongoose.Types.ObjectId(), correctOption: 'A' }]
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  // Recent completed attempt submitted 500ms ago
  const storedResults = [
    {
      _id: new mongoose.Types.ObjectId(),
      studentId,
      examId,
      attemptNumber: 1,
      status: 'Completed',
      score: 1,
      totalMarks: 1,
      totalAttempted: 1,
      totalCorrect: 1,
      totalWrong: 0,
      createdAt: new Date(Date.now() - 500),
      updatedAt: new Date(Date.now() - 500),
    }
  ];

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);
    TestResult.find = () => queryWith([...storedResults]);
    TestResult.countDocuments = async () => 1;
    TestResult.create = async () => {
      assert.fail('Duplicate attempt must NOT be created');
    };

    const duplicateRes = responseRecorder();
    await submitExam({
      user,
      params: { id: examId.toString() },
      body: { answers: [{ questionId: mockExam.questions[0]._id.toString(), selectedOption: 'A' }] }
    }, duplicateRes);

    assert.equal(duplicateRes.statusCode, 200);
    assert.equal(duplicateRes.body.success, true);
    assert.equal(duplicateRes.body.message, 'Exam already submitted.');
    assert.equal(duplicateRes.body.data.score, 1);
  } finally {
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    TestResult.create = original.resultCreate;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Exam.findById = original.examFindById;
  }
});

test('7. Exam attempt limit (maxAttempts) is strictly enforced', async () => {
  const original = {
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    examFindById: Exam.findById,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Single Attempt Exam',
    maxAttempts: 1,
    questions: []
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);
    TestResult.countDocuments = async () => 1; // 1 attempt already completed
    TestResult.find = () => queryWith([{ status: 'Completed' }]);
    TestResult.findOne = () => queryWith(null);

    // Attempt start when maxAttempts reached
    const startRes = responseRecorder();
    await startExam({ user, params: { id: examId.toString() } }, startRes);

    assert.equal(startRes.statusCode, 403);
    assert.match(startRes.body.message, /Maximum attempts \(1\) reached/);

    // Attempt direct submission when maxAttempts reached
    const submitRes = responseRecorder();
    await submitExam({ user, params: { id: examId.toString() }, body: {} }, submitRes);

    assert.equal(submitRes.statusCode, 403);
    assert.match(submitRes.body.message, /Maximum attempts \(1\) reached/);
  } finally {
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Exam.findById = original.examFindById;
  }
});

test('8 & 10. Admin Exam Results accurately distinguishes studentsAttended from total attempts and annotates attemptNumber', async () => {
  const original = {
    examFindById: Exam.findById,
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultDistinct: TestResult.distinct,
    resultAggregate: TestResult.aggregate,
    studentFind: Student.find,
    userFind: User.find,
  };

  const examId = new mongoose.Types.ObjectId();
  const student1Id = new mongoose.Types.ObjectId();
  const student2Id = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Physiology Comprehensive Exam',
    totalQuestions: 50,
    durationMinutes: 90,
  };

  // Student 1 attempted twice, Student 2 attempted once = 3 total attempts, 2 distinct students attended
  const rawResults = [
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: student1Id,
      examId,
      attemptNumber: 2,
      score: 85,
      totalMarks: 100,
      percentage: 85,
      totalAttempted: 50,
      totalCorrect: 45,
      totalWrong: 5,
      unansweredQuestions: 0,
      status: 'Completed',
      createdAt: new Date('2026-10-28T14:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: student1Id,
      examId,
      attemptNumber: 1,
      score: 60,
      totalMarks: 100,
      percentage: 60,
      totalAttempted: 48,
      totalCorrect: 35,
      totalWrong: 13,
      unansweredQuestions: 2,
      status: 'Completed',
      createdAt: new Date('2026-10-28T10:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: student2Id,
      examId,
      attemptNumber: 1,
      score: 70,
      totalMarks: 100,
      percentage: 70,
      totalAttempted: 49,
      totalCorrect: 38,
      totalWrong: 11,
      unansweredQuestions: 1,
      status: 'Completed',
      createdAt: new Date('2026-10-28T11:00:00Z'),
    }
  ];

  try {
    Exam.findById = () => queryWith(mockExam);
    TestResult.countDocuments = async () => rawResults.length;
    TestResult.distinct = async () => [student1Id.toString(), student2Id.toString()];
    TestResult.find = () => queryWith(rawResults);
    TestResult.aggregate = async () => [
      { _id: student1Id, totalAttempts: 2, bestScore: 85 },
      { _id: student2Id, totalAttempts: 1, bestScore: 70 },
    ];

    Student.find = () => queryWith([
      { _id: student1Id, name: 'Alice Student', email: 'alice@wca.com' },
      { _id: student2Id, name: 'Bob Student', email: 'bob@wca.com' }
    ]);
    User.find = () => queryWith([]);

    const adminRes = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { page: '1', limit: '20' }
    }, adminRes);

    assert.equal(adminRes.statusCode, 200);
    assert.equal(adminRes.body.success, true);
    assert.equal(adminRes.body.studentsAttended, 2, 'studentsAttended must be distinct unique student count');
    assert.equal(adminRes.body.totalAttempts, 3, 'totalAttempts must equal total submission rows');
    assert.equal(adminRes.body.total, 2, 'total students for pagination must be 2');
    assert.equal(adminRes.body.totalQuestions, 50);
    assert.equal(adminRes.body.durationMinutes, 90);

    const rows = adminRes.body.data;
    assert.equal(rows.length, 2, 'Each student must appear only once in the table');

    // Verify student 1 (Alice) summary and nested attempts
    assert.equal(rows[0].studentName, 'Alice Student');
    assert.equal(rows[0].score, 85);
    assert.equal(rows[0].bestScore, 85);
    assert.equal(rows[0].totalAttempts, 2);
    assert.equal(rows[0].attempts.length, 2);
    assert.equal(rows[0].attempts[0].attemptNumber, 1);
    assert.equal(rows[0].attempts[0].score, 60);
    assert.equal(rows[0].attempts[1].attemptNumber, 2);
    assert.equal(rows[0].attempts[1].score, 85);

    // Verify student 2 (Bob) summary and nested attempt
    assert.equal(rows[1].studentName, 'Bob Student');
    assert.equal(rows[1].score, 70);
    assert.equal(rows[1].totalAttempts, 1);
    assert.equal(rows[1].attempts.length, 1);
    assert.equal(rows[1].bestScore, 70);
  } finally {
    Exam.findById = original.examFindById;
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.distinct = original.resultDistinct;
    TestResult.aggregate = original.resultAggregate;
    Student.find = original.studentFind;
    User.find = original.userFind;
  }
});

test('12. Unani exam reattempt flow creates sequential attemptNumber and calculates latest/best scores', async () => {
  const original = {
    unaniExamFindOne: UnaniExam.findOne,
    unaniExamFindById: UnaniExam.findById,
    resultFind: UnaniExamResult.find,
    resultFindOne: UnaniExamResult.findOne,
    studentFindById: Student.findById,
    studentFindOne: Student.findOne,
  };

  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockUnaniExam = {
    _id: examId,
    courseId: 'unani',
    title: 'Unani Grand Mock Test 1',
    marksPerQuestion: 2,
    negativeMark: 0.5,
    questions: [
      { _id: new mongoose.Types.ObjectId(), questionText: 'UQ1', correctOption: 'A' },
      { _id: new mongoose.Types.ObjectId(), questionText: 'UQ2', correctOption: 'B' },
    ]
  };

  let unaniResults = [];

  try {
    UnaniExam.findOne = () => queryWith(mockUnaniExam);
    UnaniExam.findById = () => queryWith(mockUnaniExam);

    Student.findById = () => queryWith({ _id: studentId });
    Student.findOne = () => queryWith({ _id: studentId });

    UnaniExamResult.find = () => queryWith([...unaniResults].sort((a, b) => b.createdAt - a.createdAt));
    UnaniExamResult.findOne = () => queryWith(unaniResults[0] || null);

    // Mock save method for unaniExamResult instances
    const origUnaniSave = UnaniExamResult.prototype.save;
    UnaniExamResult.prototype.save = async function() {
      unaniResults.push(this);
      return this;
    };

    const studentUser = { id: studentId.toString(), studentId: studentId.toString(), role: 'student' };

    // Attempt 1: 1 correct (A), 1 wrong (C) -> score = 2 - 0.5 = 1.5
    const submit1 = await unaniExamService.submitStudentExam(examId.toString(), studentUser, {
      answers: [
        { questionId: mockUnaniExam.questions[0]._id.toString(), selectedOption: 'A' },
        { questionId: mockUnaniExam.questions[1]._id.toString(), selectedOption: 'C' }
      ]
    });

    assert.equal(submit1.attemptNumber, 1);
    assert.equal(submit1.totalAttempts, 1);
    assert.equal(submit1.latestScore, 1.5);
    assert.equal(submit1.bestScore, 1.5);

    // Fast-forward timestamp to simulate distinct reattempt
    unaniResults[0].createdAt = new Date(Date.now() - 60000);
    unaniResults[0].updatedAt = new Date(Date.now() - 60000);

    // Attempt 2 (Reattempt): Both correct -> score = 2 + 2 = 4
    const submit2 = await unaniExamService.submitStudentExam(examId.toString(), studentUser, {
      answers: [
        { questionId: mockUnaniExam.questions[0]._id.toString(), selectedOption: 'A' },
        { questionId: mockUnaniExam.questions[1]._id.toString(), selectedOption: 'B' }
      ]
    });

    assert.equal(submit2.attemptNumber, 2);
    assert.equal(submit2.totalAttempts, 2);
    assert.equal(submit2.latestScore, 4);
    assert.equal(submit2.bestScore, 4);

    assert.equal(unaniResults.length, 2);
    assert.equal(unaniResults[0].attemptNumber, 1);
    assert.equal(unaniResults[1].attemptNumber, 2);

    UnaniExamResult.prototype.save = origUnaniSave;
  } finally {
    UnaniExam.findOne = original.unaniExamFindOne;
    UnaniExam.findById = original.unaniExamFindById;
    UnaniExamResult.find = original.resultFind;
    UnaniExamResult.findOne = original.resultFindOne;
    Student.findById = original.studentFindById;
    Student.findOne = original.studentFindOne;
  }
});


test('13. checkReattemptEligibility verifies eligibility, attempt counts, and maxAttempts limit for academic exams', async () => {
  const original = {
    examFindById: Exam.findById,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Eligibility Test Exam',
    testType: 'grand_mock',
    maxAttempts: 2,
    questions: []
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);

    // Scenario A: 1 previous completed attempt -> eligible for reattempt (attempt 2 of 2)
    TestResult.find = () => queryWith([
      { _id: new mongoose.Types.ObjectId(), studentId, examId, attemptNumber: 1, score: 70, status: 'Completed', createdAt: new Date() }
    ]);
    TestResult.findOne = () => queryWith(null);

    const resA = responseRecorder();
    await checkReattemptEligibility({ user, params: { id: examId.toString() } }, resA);

    assert.equal(resA.statusCode, 200);
    assert.equal(resA.body.eligible, true);
    assert.equal(resA.body.isReattempt, true);
    assert.equal(resA.body.totalAttempts, 1);
    assert.equal(resA.body.maxAttempts, 2);
    assert.equal(resA.body.attemptsRemaining, 1);
    assert.equal(resA.body.latestScore, 70);
    assert.equal(resA.body.bestScore, 70);

    // Scenario B: 2 previous completed attempts -> maxAttempts reached, eligible: false
    TestResult.find = () => queryWith([
      { _id: new mongoose.Types.ObjectId(), studentId, examId, attemptNumber: 2, score: 85, status: 'Completed', createdAt: new Date() },
      { _id: new mongoose.Types.ObjectId(), studentId, examId, attemptNumber: 1, score: 70, status: 'Completed', createdAt: new Date(Date.now() - 10000) }
    ]);

    const resB = responseRecorder();
    await checkReattemptEligibility({ user, params: { id: examId.toString() } }, resB);

    assert.equal(resB.statusCode, 200);
    assert.equal(resB.body.eligible, false);
    assert.equal(resB.body.isReattempt, true);
    assert.equal(resB.body.totalAttempts, 2);
    assert.equal(resB.body.attemptsRemaining, 0);
    assert.match(resB.body.reason, /Maximum attempts \(2\) reached/);
  } finally {
    Exam.findById = original.examFindById;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
  }
});

test('14. checkReattemptEligibility for Unani exam accurately verifies attempt limits and prior score history', async () => {
  const original = {
    unaniExamFindOne: UnaniExam.findOne,
    unaniExamResultFind: UnaniExamResult.find,
    studentFindById: Student.findById,
    studentFindOne: Student.findOne,
  };

  const studentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Unani Comprehensive Eligibility',
    courseId: 'unani',
    maxAttempts: 1,
    questions: []
  };

  const user = { id: studentId.toString(), studentId: studentId.toString(), role: 'student' };

  try {
    Student.findById = () => queryWith({ _id: studentId, role: 'student' });
    Student.findOne = () => queryWith({ _id: studentId, role: 'student' });
    UnaniExam.findOne = () => queryWith(mockExam);

    // 1 attempt already completed with score 80
    UnaniExamResult.find = () => queryWith([
      { _id: new mongoose.Types.ObjectId(), examId, studentId, attemptNumber: 1, score: 80, status: 'Completed', createdAt: new Date() }
    ]);

    const result = await unaniExamService.checkReattemptEligibility(examId.toString(), user);

    assert.equal(result.eligible, false);
    assert.equal(result.isReattempt, true);
    assert.equal(result.totalAttempts, 1);
    assert.equal(result.maxAttempts, 1);
    assert.equal(result.attemptsRemaining, 0);
    assert.equal(result.latestScore, 80);
    assert.match(result.reason, /Maximum attempts \(1\) reached/);
  } finally {
    UnaniExam.findOne = original.unaniExamFindOne;
    UnaniExamResult.find = original.unaniExamResultFind;
    Student.findById = original.studentFindById;
    Student.findOne = original.studentFindOne;
  }
});

test('15. getStudentAvailableExams for Unani returns student attempt status, scores, and total attempts', async () => {
  const original = {
    unaniExamFind: UnaniExam.find,
    unaniExamResultFind: UnaniExamResult.find,
    studentFindById: Student.findById,
    studentFindOne: Student.findOne,
  };

  const studentId = new mongoose.Types.ObjectId();
  const exam1Id = new mongoose.Types.ObjectId();
  const exam2Id = new mongoose.Types.ObjectId();

  const mockExams = [
    { _id: exam1Id, title: 'Unani Test 1 (Attempted)', courseId: 'unani', status: 'Published', questions: [{ questionText: 'Q1' }] },
    { _id: exam2Id, title: 'Unani Test 2 (Not Attempted)', courseId: 'unani', status: 'Published', questions: [{ questionText: 'Q1' }] }
  ];

  const user = { id: studentId.toString(), studentId: studentId.toString(), role: 'student' };

  try {
    Student.findById = () => queryWith({ _id: studentId, role: 'student' });
    Student.findOne = () => queryWith({ _id: studentId, role: 'student' });
    UnaniExam.find = () => queryWith(mockExams);

    // Student attempted exam1 twice (score 60, then reattempt score 90)
    UnaniExamResult.find = () => queryWith([
      { _id: new mongoose.Types.ObjectId(), examId: exam1Id, studentId, attemptNumber: 2, score: 90, status: 'Completed', createdAt: new Date('2026-10-28T12:00:00Z') },
      { _id: new mongoose.Types.ObjectId(), examId: exam1Id, studentId, attemptNumber: 1, score: 60, status: 'Completed', createdAt: new Date('2026-10-28T10:00:00Z') },
    ]);

    const available = await unaniExamService.getStudentAvailableExams(user);

    assert.equal(available.length, 2);

    const test1 = available.find(e => e.id === exam1Id.toString());
    assert.equal(test1.status, 'Completed');
    assert.equal(test1.isCompleted, true);
    assert.equal(test1.totalAttempts, 2);
    assert.equal(test1.latestScore, 90);
    assert.equal(test1.bestScore, 90);

    const test2 = available.find(e => e.id === exam2Id.toString());
    assert.equal(test2.status, 'Published');
    assert.equal(test2.isCompleted, false);
    assert.equal(test2.totalAttempts, 0);
    assert.equal(test2.latestScore, null);
  } finally {
    UnaniExam.find = original.unaniExamFind;
    UnaniExamResult.find = original.unaniExamResultFind;
    Student.findById = original.studentFindById;
    Student.findOne = original.studentFindOne;
  }
});

test('16. getAvailableExams returns canReattempt: true and attempt metrics for completed Grand Mock Tests', async () => {
  const original = {
    examCount: Exam.countDocuments,
    examFind: Exam.find,
    resultFind: TestResult.find,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const exam1Id = new mongoose.Types.ObjectId();
  const exam2Id = new mongoose.Types.ObjectId();

  const mockExams = [
    {
      _id: exam1Id,
      title: 'Grand Mock Test 1 (Unlimited Attempts)',
      testType: 'grand_mock',
      status: 'Published',
      marksPerQuestion: 4,
      totalQuestions: 25,
      durationMinutes: 60,
    },
    {
      _id: exam2Id,
      title: 'Grand Mock Test 2 (Max 1 Attempt Limit)',
      testType: 'grand_mock',
      status: 'Published',
      maxAttempts: 1,
      marksPerQuestion: 4,
      totalQuestions: 25,
      durationMinutes: 60,
    }
  ];

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  // Student has completed 1 attempt on Exam 1 (score: 80) and 1 attempt on Exam 2 (score: 90)
  const storedResults = [
    {
      _id: new mongoose.Types.ObjectId(),
      studentId,
      examId: exam1Id,
      attemptNumber: 1,
      score: 80,
      totalMarks: 100,
      status: 'Completed',
      createdAt: new Date('2026-10-28T10:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId,
      examId: exam2Id,
      attemptNumber: 1,
      score: 90,
      totalMarks: 100,
      status: 'Completed',
      createdAt: new Date('2026-10-28T11:00:00Z'),
    }
  ];

  try {
    Exam.countDocuments = async () => mockExams.length;
    Exam.find = () => queryWith(mockExams);
    TestResult.find = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.examId && filter.examId.$in) {
        const idStrings = filter.examId.$in.map(id => id.toString());
        filtered = filtered.filter(r => idStrings.includes(r.examId.toString()));
      }
      return queryWith(filtered);
    };
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);

    const res = responseRecorder();
    await getAvailableExams({ user, query: { testType: 'grand_mock' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 2);

    const test1 = res.body.data.find(e => e._id.toString() === exam1Id.toString());
    assert.equal(test1.isCompleted, true);
    assert.equal(test1.attemptStatus, 'completed');
    assert.equal(test1.totalAttempts, 1);
    assert.equal(test1.latestScore, 80);
    assert.equal(test1.bestScore, 80);
    assert.equal(test1.canReattempt, true);
    assert.equal(test1.isReattemptEligible, true);
    assert.equal(test1.allowReattempt, true);
    assert.equal(test1.maxAttempts, null);
    assert.equal(test1.attemptsRemaining, null);

    const test2 = res.body.data.find(e => e._id.toString() === exam2Id.toString());
    assert.equal(test2.isCompleted, true);
    assert.equal(test2.totalAttempts, 1);
    assert.equal(test2.maxAttempts, 1);
    assert.equal(test2.attemptsRemaining, 0);
    assert.equal(test2.canReattempt, false);
    assert.equal(test2.isReattemptEligible, false);
  } finally {
    Exam.countDocuments = original.examCount;
    Exam.find = original.examFind;
    TestResult.find = original.resultFind;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
  }
});

test('17. startExam marks stale/abandoned in-progress attempt as Abandoned and creates clean attempt', async () => {
  const original = {
    resultCount: TestResult.countDocuments,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    resultFindById: TestResult.findById,
    resultFindByIdAndUpdate: TestResult.findByIdAndUpdate,
    resultCreate: TestResult.create,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    userFind: User.find,
    userFindOne: User.findOne,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    examFindById: Exam.findById,
  };

  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Stale Reattempt Grand Mock',
    testType: 'grand_mock',
    marksPerQuestion: 2,
    durationMinutes: 30, // 30 mins
    totalQuestions: 1,
    questions: [
      { _id: new mongoose.Types.ObjectId(), questionText: 'Q1', options: { A: 'A', B: 'B' }, correctOption: 'A' }
    ]
  };

  const mockStudent = { _id: studentId, userId, role: 'student', accountStatus: 'Approved', isApproved: true };
  const user = { id: userId.toString(), studentId: studentId.toString(), role: 'student' };

  // Attempt 1 was completed yesterday
  const attempt1 = {
    _id: new mongoose.Types.ObjectId(),
    studentId,
    examId,
    attemptNumber: 1,
    status: 'Completed',
    score: 2,
    createdAt: new Date(Date.now() - 86400000),
  };

  // Attempt 2 was started 3 hours ago (stale, duration is 30 mins) and left In Progress
  const staleAttempt2 = {
    _id: new mongoose.Types.ObjectId(),
    studentId,
    examId,
    attemptNumber: 2,
    status: 'In Progress',
    answers: [{ questionId: mockExam.questions[0]._id, selectedOption: 'B' }],
    createdAt: new Date(Date.now() - 3 * 3600000),
    updatedAt: new Date(Date.now() - 3 * 3600000),
  };

  let storedResults = [attempt1, staleAttempt2];

  try {
    Student.find = () => queryWith([mockStudent]);
    Student.findOne = () => queryWith(mockStudent);
    Student.findById = () => queryWith(mockStudent);
    User.find = () => queryWith([]);
    User.findOne = () => queryWith(null);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    Exam.findById = () => queryWith(mockExam);

    TestResult.countDocuments = async (filter = {}) => {
      if (filter.status) {
        return storedResults.filter(r => ['Completed', 'Attempted'].includes(r.status)).length;
      }
      return storedResults.length;
    };

    TestResult.findOne = (filter = {}) => {
      let filtered = [...storedResults];
      if (filter.status === 'In Progress') {
        filtered = filtered.filter(r => r.status === 'In Progress');
      }
      return queryWith(filtered[0] || null);
    };

    TestResult.findByIdAndUpdate = async (id, update) => {
      const target = storedResults.find(r => r._id.toString() === id.toString());
      if (target && update.$set) {
        Object.assign(target, update.$set);
      }
      return target;
    };

    TestResult.create = async (doc) => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      storedResults.push(created);
      return created;
    };

    // Starting exam should detect that attempt 2 is stale (> 30 mins)
    // and transition it to 'Abandoned', then create a fresh attempt with attemptNumber: 2
    const startRes = responseRecorder();
    await startExam({ user, params: { id: examId.toString() }, query: {} }, startRes);

    assert.equal(startRes.statusCode, 200);
    assert.equal(startRes.body.data.attemptNumber, 2);
    assert.equal(startRes.body.data.isReattempt, true);
    assert.equal(startRes.body.data.canReattempt, true);

    // Stale attempt was marked Abandoned
    assert.equal(staleAttempt2.status, 'Abandoned');

    // Fresh in-progress attempt was created
    const freshAttempt = storedResults.find(r => r.status === 'In Progress');
    assert.ok(freshAttempt);
    assert.notEqual(freshAttempt._id.toString(), staleAttempt2._id.toString());
    assert.equal(freshAttempt.attemptNumber, 2);
    assert.deepEqual(freshAttempt.answers, []);
  } finally {
    TestResult.countDocuments = original.resultCount;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    TestResult.findById = original.resultFindById;
    TestResult.findByIdAndUpdate = original.resultFindByIdAndUpdate;
    TestResult.create = original.resultCreate;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    User.find = original.userFind;
    User.findOne = original.userFindOne;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Exam.findById = original.examFindById;
  }
});
