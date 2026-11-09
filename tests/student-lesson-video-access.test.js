const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStudentLessonVideoAccess } = require('../utils/studentLessonVideoAccess');

const studentBase = { _id: 'student-1', userId: 'user-1', status: 'Active', accountStatus: 'Approved', isActive: true, subscriptionStatus: 'Active', subscriptionExpiresAt: new Date(Date.now() + 60000), courseIds: ['C-1'] };
const courseBase = { _id: 'course-1', courseId: 'C-1', status: 'Published', modules: [{ lessons: [{ _id: 'lesson-1', videoS3Key: 'videos/one.mp4', videoParts: [{ s3Key: 'videos/part.mp4' }] }, { _id: 'lesson-2', videoS3Key: 'videos/two.mp4' }] }] };
function mocks(student = studentBase, course = courseBase) {
  const query = (value) => ({ lean: async () => value });
  return {
    Student: { findById: () => query(student), findOne: () => query(student) },
    Course: {
      findOne: () => query(course),
      find: () => query(course ? (Array.isArray(course) ? course : [course]) : []),
    },
  };
}
const request = (overrides = {}) => ({ user: { role: 'student', id: '507f1f77bcf86cd799439011', studentId: '507f1f77bcf86cd799439012' }, courseId: 'C-1', s3Key: 'videos/one.mp4', models: mocks(), ...overrides });

test('rejects unauthenticated and non-student identities', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ user: null }))).status, 401);
  assert.equal((await resolveStudentLessonVideoAccess(request({ user: { role: 'admin' } }))).status, 401);
});
test('rejects invalid student, inactive account, and invalid or expired subscription', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(null) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, status: 'Inactive' }) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, subscriptionStatus: 'Expired' }) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, subscriptionExpiresAt: new Date(Date.now() - 1) }) }))).status, 403);
});
test('rejects an active subscriber who is not enrolled and invalid course', async () => {
  const activeNonEnrollee = { ...studentBase, courseIds: [], courseId: '', courseRef: null, subscriptionStatus: 'Active' };
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(activeNonEnrollee) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(activeNonEnrollee), courseId: '' }))).status, 403);
});
test('rejects unpublished course and video key belonging to a different course', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(studentBase, { ...courseBase, status: 'Draft' }) }))).status, 404);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(studentBase, { ...courseBase, _id: 'course-2', courseId: 'C-2' }) }))).status, 403);
});
test('supports legacy courseId and courseRef enrollment identifiers', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, courseIds: [], courseId: 'C-1', courseRef: null }) }))).status, 200);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, courseIds: [], courseId: '', courseRef: 'course-1' }) }))).status, 200);
});
test('matches only exact video keys in lessons embedded in the requested course', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ s3Key: 'videos/two.mp4' }))).status, 200);
  assert.equal((await resolveStudentLessonVideoAccess(request({ s3Key: 'videos/other-course.mp4' }))).status, 404);
  assert.equal((await resolveStudentLessonVideoAccess(request({ s3Key: 'videos/one.mp4?other' }))).status, 404);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(studentBase, { ...courseBase, modules: [{ lessons: [{ _id: 'wrong-course-lesson', videoS3Key: 'videos/one.mp4' }] }] }) }))).status, 200);
});
test('accepts the authenticated course lesson video and embedded video part', async () => {
  const direct = await resolveStudentLessonVideoAccess(request());
  assert.equal(direct.status, 200);
  assert.equal(direct.lesson._id, 'lesson-1');
  assert.equal((await resolveStudentLessonVideoAccess(request({ s3Key: 'videos/part.mp4' }))).status, 200);
});
test('supports s3Key-only requests without courseId for enrolled students', async () => {
  // s3Key-only request resolves course and lesson when video exists in student enrolled course
  const res = await resolveStudentLessonVideoAccess(request({ courseId: '' }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
  assert.equal(res.course.courseId, 'C-1');

  // s3Key-only request with undefined courseId
  const resUndefined = await resolveStudentLessonVideoAccess(request({ courseId: undefined }));
  assert.equal(resUndefined.status, 200);

  // s3Key-only request for non-enrolled video returns 404
  const resMissing = await resolveStudentLessonVideoAccess(request({ courseId: '', s3Key: 'videos/non-existent.mp4' }));
  assert.equal(resMissing.status, 404);

  // invalid s3Key returns 400
  assert.equal((await resolveStudentLessonVideoAccess(request({ courseId: '', s3Key: '' }))).status, 400);
});
