const test = require('node:test');
const assert = require('node:assert/strict');
const Exam = require('../models/Exam');
const examController = require('../controllers/examController');
const {
  normalizeExamCourseIds,
  getExamAssignedCourseIds,
  getStudentAssignedCourseIds,
  studentMatchesExamCourseAssignment,
  expandLegacyCourseFiltersForExamArrays,
  buildStudentPublishedExamClause,
} = require('../utils/examCourseAssignment');

const A = 'CRS-000075';
const B = 'CRS-000074';
const C = 'CRS-000073';
const OTHER = 'CRS-000099';

test('Exam schema persists multi-course IDs and retains the legacy scalar field', () => {
  assert.ok(Exam.schema.path('courseId'));
  assert.ok(Exam.schema.path('courseIds'));
  assert.equal(Exam.schema.path('courseIds').instance, 'Array');
});

test('Admin create persists selected courseIds and keeps courseId as the first-course legacy field', async () => {
  const originalCreate = Exam.create;
  let savedDocument;
  Exam.create = async (document) => {
    savedDocument = document;
    return document;
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await examController.createGrandMockExam({
      body: {
        title: 'Multi-course integration fixture',
        testType: 'course_test',
        courseId: OTHER,
        courseIds: [A, B, C, A],
        courseName: 'Selected courses',
        moduleName: 'Selected module',
        marksPerQuestion: 1,
        durationMinutes: 30,
        totalQuestions: 1,
        questions: [{
          questionText: 'Fixture question',
          options: { A: 'one', B: 'two', C: 'three', D: 'four' },
          correctOption: 'A',
        }],
        status: 'Published',
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(savedDocument.courseIds, [A, B, C]);
    assert.equal(savedDocument.courseId, A);
    assert.equal(res.body.exam.courseIds.length, 3);
  } finally {
    Exam.create = originalCreate;
  }
});

test('Admin update replaces the selected courseIds and preserves a single-course fallback', async () => {
  const originalFindById = Exam.findById;
  const originalUpdate = Exam.findByIdAndUpdate;
  const id = '507f1f77bcf86cd799439011';
  let update;
  Exam.findById = async () => ({ _id: id, testType: 'course_test', courseId: A, courseIds: [A, B], moduleId: null });
  Exam.findByIdAndUpdate = async (_id, updateDoc) => {
    update = updateDoc.$set;
    return { _id, ...update };
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await examController.updateGrandMockExam({ params: { id }, body: { courseIds: [B, C, B] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(update.courseIds, [B, C]);
    assert.equal(update.courseId, B);
  } finally {
    Exam.findById = originalFindById;
    Exam.findByIdAndUpdate = originalUpdate;
  }
});

test('one-course and legacy single-course assignments continue matching', () => {
  assert.deepEqual(normalizeExamCourseIds([], A), [A]);
  assert.equal(studentMatchesExamCourseAssignment(
    { courseId: A },
    { courseId: A }
  ), true);
});

test('two- and three-course exams match a student enrolled in any assigned course', () => {
  const twoCourseExam = { courseId: A, courseIds: [A, B], testType: 'course_test' };
  const threeCourseExam = { courseId: A, courseIds: [A, B, C], testType: 'course_test' };
  assert.equal(studentMatchesExamCourseAssignment(twoCourseExam, { courseIds: [A] }), true);
  assert.equal(studentMatchesExamCourseAssignment(twoCourseExam, { courseIds: [B] }), true);
  assert.equal(studentMatchesExamCourseAssignment(threeCourseExam, { courseIds: [C] }), true);
});

test('a student matching multiple assigned courses still resolves to one exam ID', () => {
  const exam = { _id: 'exam-1', courseId: A, courseIds: [A, B, C] };
  const student = { courseIds: [A, B] };
  const matchingExamIds = [exam, exam]
    .filter((item) => studentMatchesExamCourseAssignment(item, student))
    .map((item) => item._id);
  assert.deepEqual([...new Set(matchingExamIds)], ['exam-1']);
  assert.deepEqual(normalizeExamCourseIds([A, B, A.toLowerCase()], A), [A, B]);
});

test('an unrelated course does not match a multi-course exam', () => {
  assert.equal(studentMatchesExamCourseAssignment(
    { courseIds: [A, B, C] },
    { courseIds: [OTHER] }
  ), false);
  assert.equal(studentMatchesExamCourseAssignment(
    { courseId: OTHER, courseIds: [A, B, C] },
    { courseIds: [OTHER] }
  ), false);
});

test('student matching accepts profile, legacy, and returned enrollment field names', () => {
  const exam = { courseIds: [A, B, C] };
  assert.equal(studentMatchesExamCourseAssignment(exam, { courseId: B }), true);
  assert.equal(studentMatchesExamCourseAssignment(exam, { registeredCourseIds: [C] }), true);
  assert.equal(studentMatchesExamCourseAssignment(exam, { enrolled_courses: [{ id: A }] }), true);
  assert.deepEqual(getStudentAssignedCourseIds({ courseIds: [A], courseId: B }), [A, B]);
  assert.deepEqual(getExamAssignedCourseIds({ courseIds: [A, B], courseId: A }), [A, B]);
});

test('discovery query matches both legacy courseId and the courseIds array', () => {
  const courseFilters = expandLegacyCourseFiltersForExamArrays([
    { courseId: { $in: [A, B, C] } },
  ]);
  assert.deepEqual(courseFilters, [
    { courseId: { $in: [A, B, C] } },
    { courseIds: { $in: [A, B, C] } },
  ]);
});

test('student discovery continues to hide Draft exams', () => {
  const publishedClause = buildStudentPublishedExamClause();
  const statusConditions = publishedClause.$or;
  const isVisibleStatus = (status, exists = true) => statusConditions.some((condition) => {
    if (Object.prototype.hasOwnProperty.call(condition, 'status')) {
      if (condition.status && condition.status.$exists === false) return !exists;
      return condition.status === status;
    }
    return false;
  });
  assert.equal(isVisibleStatus('Published'), true);
  assert.equal(isVisibleStatus('published'), true);
  assert.equal(isVisibleStatus('Draft'), false);
  assert.equal(isVisibleStatus(undefined, false), true);
});
