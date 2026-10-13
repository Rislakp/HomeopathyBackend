const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Course = require('../models/Course');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const studentRouter = require('../src/student/student.routes');
const { getAvailableExams } = require('../src/student/student.controller');
const { verifyStudentCourseAccessAny } = require('../utils/courseAccessHelper');

const A = 'CRS-000075';
const B = 'CRS-000074';
const C = 'CRS-000073';
const OTHER = 'CRS-000099';

function queryWith(docs) {
  const state = { skip: 0, limit: Infinity };
  return {
    select() { return this; },
    sort() { return this; },
    skip(value) { state.skip = value; return this; },
    limit(value) { state.limit = value; return this; },
    async lean() { return docs.slice(state.skip, state.skip + state.limit); },
  };
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(doc, part));
    if (key === '$or') return condition.some((part) => matches(doc, part));
    const actual = doc[key];
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if (Object.prototype.hasOwnProperty.call(condition, '$in')) {
        return Array.isArray(actual)
          ? actual.some((value) => condition.$in.some((candidate) => String(candidate) === String(value)))
          : condition.$in.some((candidate) => String(candidate) === String(actual));
      }
      if (Object.prototype.hasOwnProperty.call(condition, '$ne')) return String(actual) !== String(condition.$ne);
      if (Object.prototype.hasOwnProperty.call(condition, '$nin')) return !condition.$nin.some((candidate) => String(candidate) === String(actual));
      if (Object.prototype.hasOwnProperty.call(condition, '$regex')) return condition.$regex.test(String(actual || ''));
      if (Object.prototype.hasOwnProperty.call(condition, '$exists')) return condition.$exists === (actual !== undefined);
      return false;
    }
    return Array.isArray(actual)
      ? actual.some((value) => String(value) === String(condition))
      : String(actual) === String(condition);
  });
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('GET /api/student/exams uses any-match courseIds and hides Draft without duplicate exam rows', async () => {
  const routeExists = studentRouter.stack.some((layer) =>
    layer.route?.path === '/api/student/exams' && layer.route.methods.get
  );
  assert.equal(routeExists, true);

  const original = {
    examFind: Exam.find,
    examCount: Exam.countDocuments,
    courseFind: Course.find,
    courseFindOne: Course.findOne,
    studentFindOne: Student.findOne,
    studentFind: Student.find,
    userFind: User.find,
    resultFind: TestResult.find,
  };

  const courseDocs = [A, B, C, OTHER].map((courseId) => ({
    _id: new mongoose.Types.ObjectId(),
    courseId,
    courseTitle: courseId,
    modules: [],
  }));
  const exams = [
    { _id: new mongoose.Types.ObjectId(), title: 'One course', testType: 'course_test', courseId: A, courseIds: [A], status: 'Published' },
    { _id: new mongoose.Types.ObjectId(), title: 'Two courses', testType: 'course_test', courseId: A, courseIds: [A, B], status: 'Published' },
    { _id: new mongoose.Types.ObjectId(), title: 'Three courses', testType: 'course_test', courseId: A, courseIds: [A, B, C], status: 'Published' },
    { _id: new mongoose.Types.ObjectId(), title: 'Legacy single course', testType: 'course_test', courseId: B, status: 'Published' },
    { _id: new mongoose.Types.ObjectId(), title: 'Draft multi-course', testType: 'course_test', courseId: A, courseIds: [A, B, C], status: 'Draft' },
    { _id: new mongoose.Types.ObjectId(), title: 'Global Grand Mock', testType: 'grand_mock', courseId: null, status: 'Published' },
  ];
  let currentStudent;

  try {
    Course.find = (filter) => queryWith(courseDocs.filter((course) => matches(course, filter)));
    Course.findOne = () => ({ select() { return this; }, async lean() { return null; } });
    Student.findOne = () => {
      const query = Promise.resolve(currentStudent);
      query.lean = async () => currentStudent;
      return query;
    };
    Student.find = () => queryWith([currentStudent]);
    User.find = () => queryWith([]);
    TestResult.find = () => queryWith([]);
    Exam.countDocuments = async (filter) => exams.filter((exam) => matches(exam, filter)).length;
    Exam.find = (filter) => queryWith(exams.filter((exam) => matches(exam, filter)));

    const requestAs = async (courseIds, courseId = '', testType = 'course_test') => {
      currentStudent = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        courseIds,
        courseId,
        course: '',
      };
      const req = {
        user: { id: currentStudent.userId.toString(), userId: currentStudent.userId.toString(), studentId: currentStudent._id.toString(), role: 'student' },
        query: { testType, page: '1', limit: '20' },
        originalUrl: `/api/student/exams?testType=${testType}`,
      };
      const res = responseRecorder();
      await getAvailableExams(req, res);
      assert.equal(res.statusCode, 200);
      return res.body.data;
    };

    const titlesFor = async (ids, legacyId = '', testType = 'course_test') =>
      (await requestAs(ids, legacyId, testType)).map((exam) => exam.title);
    assert.deepEqual((await titlesFor([A])).sort(), ['One course', 'Three courses', 'Two courses'].sort());
    assert.deepEqual((await titlesFor([B])).sort(), ['Legacy single course', 'Three courses', 'Two courses'].sort());
    assert.deepEqual((await titlesFor([C])), ['Three courses']);
    assert.deepEqual((await titlesFor([A, B])).sort(), ['Legacy single course', 'One course', 'Three courses', 'Two courses'].sort());
    assert.deepEqual(await titlesFor([OTHER]), []);
    assert.deepEqual((await titlesFor([], B)).sort(), ['Legacy single course', 'Three courses', 'Two courses'].sort());
    assert.equal((await requestAs([A, B])).filter((exam) => exam.title === 'Two courses').length, 1);
    assert.equal((await titlesFor([A])).includes('Draft multi-course'), false);
    assert.deepEqual(await titlesFor([OTHER], '', 'grand_mock'), ['Global Grand Mock']);

    currentStudent = { _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), courseIds: [B] };
    const studentUser = { id: currentStudent.userId.toString(), userId: currentStudent.userId.toString(), role: 'student' };
    assert.equal(await verifyStudentCourseAccessAny(studentUser, [A, B, C]), true);
    assert.equal(await verifyStudentCourseAccessAny(studentUser, [OTHER]), false);
  } finally {
    Exam.find = original.examFind;
    Exam.countDocuments = original.examCount;
    Course.find = original.courseFind;
    Course.findOne = original.courseFindOne;
    Student.findOne = original.studentFindOne;
    Student.find = original.studentFind;
    User.find = original.userFind;
    TestResult.find = original.resultFind;
  }
});
