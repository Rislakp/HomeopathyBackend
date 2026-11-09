const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveStudentLessonVideoAccess,
  getStudentPlaybackEligibilityError,
} = require('../utils/studentLessonVideoAccess');

const studentBase = { _id: 'student-1', userId: 'user-1', status: 'Active', accountStatus: 'Approved', isActive: true, subscriptionStatus: 'Active', subscriptionExpiresAt: new Date(Date.now() + 60000), courseIds: ['C-1'] };
const courseBase = { _id: 'course-1', courseId: 'C-1', status: 'Published', modules: [{ lessons: [{ _id: 'lesson-1', videoS3Key: 'videos/one.mp4', videoParts: [{ s3Key: 'videos/part.mp4' }] }, { _id: 'lesson-2', videoS3Key: 'videos/two.mp4' }] }] };
function mocks(student = studentBase, course = courseBase) {
  const query = (value) => ({ lean: async () => value });
  const courses = Array.isArray(course) ? course : [course];
  return { Student: { findById: () => query(student), findOne: () => query(student) }, Course: { findOne: () => query(courses[0]), find: () => query(courses) } };
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
  assert.equal((await resolveStudentLessonVideoAccess(request({ courseId: '' }))).status, 400);
});
test('rejects unpublished course and video key belonging to a different course', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(studentBase, { ...courseBase, status: 'Draft' }) }))).status, 404);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(studentBase, { ...courseBase, _id: 'course-2', courseId: 'C-2' }) }))).status, 403);
});
test('supports legacy courseId and courseRef enrollment identifiers', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, courseIds: [], courseId: 'C-1', courseRef: null }) }))).status, 200);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, courseIds: [], courseId: '', courseRef: 'course-1' }) }))).status, 200);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, courseIds: [], courseId: '', courseRef: null, course: 'Foundations' }, { ...courseBase, courseTitle: 'foundations' }) }))).status, 200);
});
test('requires both an eligible account and a current subscription', () => {
  assert.equal(getStudentPlaybackEligibilityError(studentBase), null);
  assert.match(getStudentPlaybackEligibilityError({ ...studentBase, status: 'Inactive' }), /account is not active/i);
  assert.match(getStudentPlaybackEligibilityError({ ...studentBase, subscriptionStatus: 'Expired' }), /active subscription/i);
  assert.match(getStudentPlaybackEligibilityError({ ...studentBase, subscriptionExpiresAt: new Date(Date.now() - 1) }), /active subscription/i);
  assert.match(getStudentPlaybackEligibilityError({ ...studentBase, accountStatus: 'Suspended' }), /account is not active/i);
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

test('supports s3Key-only access when exactly one authorized lesson owns the key', async () => {
  const result = await resolveStudentLessonVideoAccess(request({ courseId: undefined }));
  assert.equal(result.status, 200);
  assert.equal(result.key, 'videos/one.mp4');
  assert.equal(result.lesson._id, 'lesson-1');
});

test('s3Key-only access denies a key without an enrolled course match', async () => {
  const unEnrolled = { ...studentBase, courseIds: [], courseId: '', courseRef: null, course: '' };
  assert.equal((await resolveStudentLessonVideoAccess(request({ courseId: undefined, models: mocks(unEnrolled) }))).status, 403);
});

test('s3Key-only access rejects ambiguous lesson ownership', async () => {
  const duplicate = { ...courseBase, _id: 'course-3', courseId: 'C-1', modules: [{ lessons: [{ _id: 'lesson-3', videoS3Key: 'videos/one.mp4' }] }] };
  assert.equal((await resolveStudentLessonVideoAccess(request({ courseId: undefined, models: mocks(studentBase, [courseBase, duplicate]) }))).status, 409);
});

test('s3Key-only access rejects missing keys', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ courseId: undefined, s3Key: '' }))).status, 400);
});
