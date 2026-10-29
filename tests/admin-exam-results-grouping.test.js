const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Exam = require('../models/Exam');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');

const { getAdminExamResults } = require('../controllers/examController');

function responseRecorder() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(key, value) {
      headers[key.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
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

test('1 & 2. Three attempts by one student produce one student summary with all 3 attempts preserved in Details', async () => {
  const original = {
    examFindById: Exam.findById,
    resultFind: TestResult.find,
    studentFind: Student.find,
    userFind: User.find,
  };

  const examId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Pathology Grand Mock Test',
    testType: 'grand_mock',
    marksPerQuestion: 1,
    totalQuestions: 15,
    durationMinutes: 45
  };

  const mockStudent = {
    _id: studentId,
    userId,
    name: 'test',
    email: 'test@gmail.com',
    phone: '9876543210'
  };

  // Student 'test' has 3 attempts:
  // Attempt 1: 7/15 (submitted first)
  // Attempt 2: 1/15 (submitted second)
  // Attempt 3: 1/15 (submitted third)
  const attempt1Id = new mongoose.Types.ObjectId();
  const attempt2Id = new mongoose.Types.ObjectId();
  const attempt3Id = new mongoose.Types.ObjectId();

  const storedAttempts = [
    {
      _id: attempt1Id,
      studentId: studentId,
      examId,
      attemptNumber: 1,
      score: 7,
      totalMarks: 15,
      totalAttempted: 15,
      totalCorrect: 7,
      totalWrong: 8,
      unansweredQuestions: 0,
      percentage: 46.67,
      status: 'Completed',
      createdAt: new Date('2026-10-28T09:00:00Z'),
    },
    {
      _id: attempt2Id,
      studentId: studentId,
      examId,
      attemptNumber: 2,
      score: 1,
      totalMarks: 15,
      totalAttempted: 15,
      totalCorrect: 1,
      totalWrong: 14,
      unansweredQuestions: 0,
      percentage: 6.67,
      status: 'Completed',
      createdAt: new Date('2026-10-28T12:00:00Z'),
    },
    {
      _id: attempt3Id,
      studentId: userId, // Demonstrates linking via userId also resolves to same student
      examId,
      attemptNumber: 3,
      score: 1,
      totalMarks: 15,
      totalAttempted: 15,
      totalCorrect: 1,
      totalWrong: 14,
      unansweredQuestions: 0,
      percentage: 6.67,
      status: 'Completed',
      createdAt: new Date('2026-10-28T15:00:00Z'),
    }
  ];

  try {
    Exam.findById = () => queryWith(mockExam);
    TestResult.find = () => queryWith(storedAttempts);
    Student.find = () => queryWith([mockStudent]);
    User.find = () => queryWith([]);

    const res = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { page: '1', limit: '20' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    // Requirement 4: studentsAttended counts unique students (1 student)
    assert.equal(res.body.studentsAttended, 1, 'Students Attended must count unique students (1)');
    assert.equal(res.body.totalAttempts, 3, 'Total Attempts must be 3');
    assert.equal(res.body.total, 1, 'Total student rows must be 1');

    const rows = res.body.data;
    // Requirement 1: Three attempts by one student produce one student summary
    assert.equal(rows.length, 1, 'Main table must show student only once');

    const studentSummary = rows[0];
    assert.equal(studentSummary.studentName, 'test');
    assert.equal(studentSummary.studentEmail, 'test@gmail.com');
    assert.equal(studentSummary.totalAttempts, 3);
    assert.equal(studentSummary.bestScore, 7);
    assert.equal(studentSummary.latestScore, 1);
    assert.equal(studentSummary.score, 7, 'Summary score displays best score 7');

    // Requirement 2: All three attempts remain available in Details
    assert.ok(Array.isArray(studentSummary.attempts));
    assert.equal(studentSummary.attempts.length, 3, 'All 3 attempts must be in nested attempts array');

    // Validate attempt 1 preservation
    const att1 = studentSummary.attempts.find(a => a.attemptNumber === 1);
    assert.ok(att1);
    assert.equal(att1.resultId, attempt1Id.toString());
    assert.equal(att1.score, 7);
    assert.equal(att1.correct, 7);
    assert.equal(att1.wrong, 8);
    assert.equal(att1.percentage, 46.67);

    // Validate attempt 2 preservation
    const att2 = studentSummary.attempts.find(a => a.attemptNumber === 2);
    assert.ok(att2);
    assert.equal(att2.resultId, attempt2Id.toString());
    assert.equal(att2.score, 1);
    assert.equal(att2.correct, 1);
    assert.equal(att2.wrong, 14);

    // Validate attempt 3 preservation
    const att3 = studentSummary.attempts.find(a => a.attemptNumber === 3);
    assert.ok(att3);
    assert.equal(att3.resultId, attempt3Id.toString());
    assert.equal(att3.score, 1);
    assert.equal(att3.correct, 1);
    assert.equal(att3.wrong, 14);

    // Requirement 6: Previous attempts are not deleted or overwritten
    assert.equal(storedAttempts.length, 3);
    assert.equal(storedAttempts[0].score, 7);
    assert.equal(storedAttempts[1].score, 1);
    assert.equal(storedAttempts[2].score, 1);
  } finally {
    Exam.findById = original.examFindById;
    TestResult.find = original.resultFind;
    Student.find = original.studentFind;
    User.find = original.userFind;
  }
});

test('3. Two different students with the same name remain separate', async () => {
  const original = {
    examFindById: Exam.findById,
    resultFind: TestResult.find,
    studentFind: Student.find,
    userFind: User.find,
  };

  const examId = new mongoose.Types.ObjectId();
  const student1Id = new mongoose.Types.ObjectId();
  const student2Id = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Pharmacology Mock',
    testType: 'grand_mock',
    marksPerQuestion: 2,
    totalQuestions: 10
  };

  // Two students with identical name 'John Smith' but different IDs and emails
  const mockStudents = [
    { _id: student1Id, name: 'John Smith', email: 'john.smith1@wca.com' },
    { _id: student2Id, name: 'John Smith', email: 'john.smith2@wca.com' }
  ];

  const storedAttempts = [
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: student1Id,
      examId,
      attemptNumber: 1,
      score: 18,
      totalMarks: 20,
      totalAttempted: 10,
      totalCorrect: 9,
      totalWrong: 1,
      status: 'Completed',
      createdAt: new Date('2026-10-28T10:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: student2Id,
      examId,
      attemptNumber: 1,
      score: 14,
      totalMarks: 20,
      totalAttempted: 10,
      totalCorrect: 7,
      totalWrong: 3,
      status: 'Completed',
      createdAt: new Date('2026-10-28T11:00:00Z'),
    }
  ];

  try {
    Exam.findById = () => queryWith(mockExam);
    TestResult.find = () => queryWith(storedAttempts);
    Student.find = () => queryWith(mockStudents);
    User.find = () => queryWith([]);

    const res = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { page: '1', limit: '20' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.studentsAttended, 2);
    assert.equal(res.body.total, 2);

    const rows = res.body.data;
    assert.equal(rows.length, 2, 'Two different students must NOT be merged even if names match');
    assert.notEqual(rows[0].studentId, rows[1].studentId);
    assert.equal(rows[0].studentEmail, 'john.smith1@wca.com');
    assert.equal(rows[1].studentEmail, 'john.smith2@wca.com');
  } finally {
    Exam.findById = original.examFindById;
    TestResult.find = original.resultFind;
    Student.find = original.studentFind;
    User.find = original.userFind;
  }
});

test('4 & 5. Pagination, search, and CSV export remain correct for grouped students', async () => {
  const original = {
    examFindById: Exam.findById,
    resultFind: TestResult.find,
    studentFind: Student.find,
    userFind: User.find,
  };

  const examId = new mongoose.Types.ObjectId();
  const s1Id = new mongoose.Types.ObjectId();
  const s2Id = new mongoose.Types.ObjectId();
  const s3Id = new mongoose.Types.ObjectId();

  const mockExam = {
    _id: examId,
    title: 'Anatomy Grand Mock',
    testType: 'grand_mock',
    marksPerQuestion: 1,
    totalQuestions: 20
  };

  const mockStudents = [
    { _id: s1Id, name: 'Alice Walker', email: 'alice@wca.com' },
    { _id: s2Id, name: 'Bob Dylan', email: 'bob@wca.com' },
    { _id: s3Id, name: 'Charlie Brown', email: 'charlie@wca.com' }
  ];

  // S1 has 2 attempts, S2 has 1 attempt, S3 has 1 attempt = 4 attempts, 3 unique students
  const storedAttempts = [
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: s1Id,
      examId,
      attemptNumber: 1,
      score: 15,
      totalMarks: 20,
      totalAttempted: 20,
      totalCorrect: 15,
      totalWrong: 5,
      status: 'Completed',
      createdAt: new Date('2026-10-28T08:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: s1Id,
      examId,
      attemptNumber: 2,
      score: 19,
      totalMarks: 20,
      totalAttempted: 20,
      totalCorrect: 19,
      totalWrong: 1,
      status: 'Completed',
      createdAt: new Date('2026-10-28T12:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: s2Id,
      examId,
      attemptNumber: 1,
      score: 12,
      totalMarks: 20,
      totalAttempted: 20,
      totalCorrect: 12,
      totalWrong: 8,
      status: 'Completed',
      createdAt: new Date('2026-10-28T09:00:00Z'),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      studentId: s3Id,
      examId,
      attemptNumber: 1,
      score: 8,
      totalMarks: 20,
      totalAttempted: 20,
      totalCorrect: 8,
      totalWrong: 12,
      status: 'Completed',
      createdAt: new Date('2026-10-28T10:00:00Z'),
    }
  ];

  try {
    Exam.findById = () => queryWith(mockExam);
    TestResult.find = (filter = {}) => {
      let filtered = [...storedAttempts];
      if (filter.studentId && filter.studentId.$in) {
        const idStrings = filter.studentId.$in.map(id => id.toString());
        filtered = filtered.filter(r => idStrings.includes(r.studentId.toString()));
      }
      return queryWith(filtered);
    };
    Student.find = (filter = {}) => {
      let filtered = [...mockStudents];
      if (filter.$or && filter.$or[0]?.name) {
        // Search query by name/email regex
        filtered = filtered.filter(s => s.name.includes('Bob') || s.email.includes('bob'));
      }
      return queryWith(filtered);
    };
    User.find = () => queryWith([]);

    // Part A: Pagination (page=1, limit=2 out of 3 students)
    const page1Res = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { page: '1', limit: '2' }
    }, page1Res);

    assert.equal(page1Res.statusCode, 200);
    assert.equal(page1Res.body.studentsAttended, 3, 'Total unique students attended = 3');
    assert.equal(page1Res.body.totalAttempts, 4, 'Total attempt records = 4');
    assert.equal(page1Res.body.total, 3, 'Total items for pagination = 3 students');
    assert.equal(page1Res.body.data.length, 2, 'Page 1 limit 2 returns 2 students');
    assert.equal(page1Res.body.pagination.page, 1);
    assert.equal(page1Res.body.pagination.limit, 2);
    assert.equal(page1Res.body.pagination.totalPages, 2);

    // Part B: Page 2 (limit=2) -> 1 remaining student
    const page2Res = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { page: '2', limit: '2' }
    }, page2Res);

    assert.equal(page2Res.statusCode, 200);
    assert.equal(page2Res.body.data.length, 1);
    assert.equal(page2Res.body.data[0].studentName, 'Charlie Brown');

    // Part C: Search filter (search='Bob')
    const searchRes = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { search: 'Bob' }
    }, searchRes);

    assert.equal(searchRes.statusCode, 200);
    assert.equal(searchRes.body.data.length, 1);
    assert.equal(searchRes.body.data[0].studentName, 'Bob Dylan');
    assert.equal(searchRes.body.studentsAttended, 1);

    // Part D: CSV summary export
    const csvRes = responseRecorder();
    await getAdminExamResults({
      params: { examId: examId.toString() },
      query: { format: 'csv' }
    }, csvRes);

    assert.equal(csvRes.statusCode, 200);
    assert.equal(csvRes.headers['content-type'], 'text/csv');
    const csvContent = csvRes.body;
    assert.match(csvContent, /Exam Name,Exam Type,Student Name,Email/);
    assert.match(csvContent, /Alice Walker/);
    assert.match(csvContent, /Bob Dylan/);
    assert.match(csvContent, /Charlie Brown/);
    // Alice Walker has 2 attempts; check summary row contains Total Attempts = 2
    assert.match(csvContent, /"Alice Walker","alice@wca\.com","19 \/ 20","95%",19,1,0,2/);
  } finally {
    Exam.findById = original.examFindById;
    TestResult.find = original.resultFind;
    Student.find = original.studentFind;
    User.find = original.userFind;
  }
});
