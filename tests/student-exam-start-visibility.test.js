const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Course = require('../models/Course');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const { getAvailableExams, startExam } = require('../src/student/student.controller');

const examId = '6accbadb7b2b5cfc521f569c';
const studentId = new mongoose.Types.ObjectId('6accbadb7b2b5cfc521f569d');
const userId = new mongoose.Types.ObjectId('6accbadb7b2b5cfc521f569e');

function queryWith(docs = []) {
  const chain = {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    async lean() { return docs; },
  };
  return chain;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(doc, part));
    if (key === '$or') return condition.some((part) => matches(doc, part));
    const actual = doc[key];
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('$ne' in condition) return actual !== condition.$ne;
      if ('$regex' in condition) return condition.$regex.test(String(actual || ''));
      if ('$exists' in condition) return condition.$exists === (actual !== undefined);
      return false;
    }
    return actual === condition;
  });
}

test('listed exam _id starts successfully; invalid, unpublished, and unauthorized course exams are rejected', async () => {
  const original = {
    examFind: Exam.find,
    examCount: Exam.countDocuments,
    examFindById: Exam.findById,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    studentFindById: Student.findById,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    userFind: User.find,
    resultFind: TestResult.find,
    resultFindOne: TestResult.findOne,
    resultCreate: TestResult.create,
  };
  const student = {
    _id: studentId,
    userId,
    role: 'student',
    accountStatus: 'Approved',
    isApproved: true,
    courseIds: ['CRS-000070', 'CRS-000075'],
  };
  const publishedGrandMock = {
    _id: new mongoose.Types.ObjectId(examId),
    title: 'Published Grand Mock',
    testType: 'grand_mock',
    status: 'Published',
    questions: [],
    totalQuestions: 0,
    marksPerQuestion: 1,
  };
  let currentExam = publishedGrandMock;
  let requestedStartId = null;

  try {
    Student.find = () => queryWith([student]);
    Student.findOne = () => queryWith(student);
    Student.findById = () => queryWith(student);
    Course.find = () => queryWith([]);
    Course.findOne = () => queryWith(null);
    User.find = () => queryWith([]);
    Exam.countDocuments = async (filter) => Number(matches(currentExam, filter));
    Exam.find = (filter) => queryWith(matches(currentExam, filter) ? [currentExam] : []);
    Exam.findById = (id) => {
      requestedStartId = id.toString();
      return queryWith(currentExam);
    };
    TestResult.find = () => queryWith([]);
    TestResult.findOne = () => queryWith(null);
    TestResult.create = async () => ({ _id: new mongoose.Types.ObjectId() });

    const user = {
      id: userId.toString(),
      userId: userId.toString(),
      studentId: studentId.toString(),
      role: 'student',
    };
    const listRes = responseRecorder();
    await getAvailableExams({
      user,
      query: { testType: 'grand_mock', page: '1', limit: '20' },
      originalUrl: '/api/student/exams?testType=grand_mock',
    }, listRes);

    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.data.length, 1);
    assert.equal(listRes.body.data[0]._id.toString(), examId);

    const startRes = responseRecorder();
    await startExam({ user, params: { id: listRes.body.data[0]._id.toString() } }, startRes);
    assert.equal(startRes.statusCode, 200);
    assert.equal(startRes.body.data._id.toString(), examId);
    assert.equal(startRes.body.success, true);
    assert.equal(requestedStartId, examId);

    for (const legacyStatus of [undefined, null, '', 'published']) {
      currentExam = { ...publishedGrandMock, status: legacyStatus };
      if (legacyStatus === undefined) delete currentExam.status;

      const legacyListRes = responseRecorder();
      await getAvailableExams({
        user,
        query: { testType: 'grand_mock', page: '1', limit: '20' },
        originalUrl: '/api/student/exams?testType=grand_mock',
      }, legacyListRes);
      assert.equal(legacyListRes.statusCode, 200);
      assert.equal(legacyListRes.body.data.length, 1, `status ${String(legacyStatus)} should remain listed`);

      const legacyStartRes = responseRecorder();
      await startExam({ user, params: { id: examId } }, legacyStartRes);
      assert.equal(legacyStartRes.statusCode, 200, `status ${String(legacyStatus)} should remain startable`);
    }

    const invalidRes = responseRecorder();
    await startExam({ user, params: { id: 'not-an-object-id' } }, invalidRes);
    assert.equal(invalidRes.statusCode, 400);
    assert.equal(invalidRes.body.message, 'Invalid Exam ID format.');

    currentExam = { ...publishedGrandMock, status: 'Draft' };
    const draftListRes = responseRecorder();
    await getAvailableExams({
      user,
      query: { testType: 'grand_mock', page: '1', limit: '20' },
      originalUrl: '/api/student/exams?testType=grand_mock',
    }, draftListRes);
    assert.equal(draftListRes.statusCode, 200);
    assert.deepEqual(draftListRes.body.data, []);

    const draftStartRes = responseRecorder();
    await startExam({ user, params: { id: examId } }, draftStartRes);
    assert.equal(draftStartRes.statusCode, 404);
    assert.equal(draftStartRes.body.message, 'Grand Mock Exam not found.');

    currentExam = null;
    const missingExamRes = responseRecorder();
    await startExam({ user, params: { id: examId } }, missingExamRes);
    assert.equal(missingExamRes.statusCode, 404);
    assert.equal(missingExamRes.body.message, 'Grand Mock Exam not found.');

    currentExam = {
      ...publishedGrandMock,
      testType: 'course_test',
      courseId: 'CRS-000099',
      courseIds: ['CRS-000099'],
    };
    const forbiddenRes = responseRecorder();
    await startExam({ user, params: { id: examId } }, forbiddenRes);
    assert.equal(forbiddenRes.statusCode, 403);
    assert.equal(forbiddenRes.body.message, 'You are not authorized to access this exam.');

    currentExam = {
      ...publishedGrandMock,
      testType: 'course_test',
      status: '',
      courseId: 'CRS-000075',
      courseIds: ['CRS-000075'],
    };
    const legacyCourseTestRes = responseRecorder();
    await startExam({ user, params: { id: examId } }, legacyCourseTestRes);
    assert.equal(legacyCourseTestRes.statusCode, 200);
  } finally {
    Exam.find = original.examFind;
    Exam.countDocuments = original.examCount;
    Exam.findById = original.examFindById;
    Student.find = original.studentFind;
    Student.findOne = original.studentFindOne;
    Student.findById = original.studentFindById;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    User.find = original.userFind;
    TestResult.find = original.resultFind;
    TestResult.findOne = original.resultFindOne;
    TestResult.create = original.resultCreate;
  }
});
