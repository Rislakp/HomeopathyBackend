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
test('rejects invalid student, inactive account, and invalid or expired subscription for non-approved accounts', async () => {
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks(null) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, status: 'Inactive', subscriptionStatus: 'None', isActive: false }) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, status: 'Pending', accountStatus: 'Pending', isApproved: false, subscriptionStatus: 'Expired' }) }))).status, 403);
  assert.equal((await resolveStudentLessonVideoAccess(request({ models: mocks({ ...studentBase, status: 'Pending', accountStatus: 'Pending', isApproved: false, subscriptionExpiresAt: new Date(Date.now() - 1) }) }))).status, 403);
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


test('s3Key-only access requires exactly one authorized lesson and rejects missing or ambiguous keys', async () => {
  const unique = await resolveStudentLessonVideoAccess(request({ courseId: undefined, s3Key: 'videos/one.mp4' }));
  assert.equal(unique.status, 200);
  assert.equal(unique.lesson._id, 'lesson-1');

  const noKey = await resolveStudentLessonVideoAccess(request({ courseId: undefined, s3Key: '' }));
  assert.equal(noKey.status, 400);

  const missing = await resolveStudentLessonVideoAccess(request({ courseId: undefined, s3Key: 'videos/not-found.mp4' }));
  assert.equal(missing.status, 404);

  const secondCourse = { ...courseBase, _id: 'course-2', courseId: 'C-2' };
  const ambiguous = await resolveStudentLessonVideoAccess(request({
    courseId: undefined,
    models: { ...mocks({ ...studentBase, courseIds: ['C-1', 'C-2'] }), Course: { findOne: () => ({ lean: async () => null }), find: () => ({ lean: async () => [courseBase, secondCourse] }) } },
  }));
  assert.equal(ambiguous.status, 409);
});

test('regression: active + approved account with subscriptionStatus None is allowed playback', async () => {
  const studentNone = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(studentNone) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('security: Inactive + Approved + isApproved=true + no subscription = 403', async () => {
  const student = {
    ...studentBase,
    status: 'Inactive',
    accountStatus: 'Approved',
    isApproved: true,
    isActive: false,
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 403);
  assert.match(res.error, /active account or subscription is required/i);
});

test('security: Active + Unapproved + no subscription = 403', async () => {
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Pending',
    isApproved: false,
    isActive: true,
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 403);
  assert.match(res.error, /active account or subscription is required/i);
});

test('security: Active + Approved + no subscription = 200', async () => {
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    isApproved: true,
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('security: Valid subscription = allowed according to existing policy even if account unapproved', async () => {
  const student = {
    ...studentBase,
    status: 'Pending',
    accountStatus: 'Pending',
    isApproved: false,
    subscriptionStatus: 'Active',
    subscriptionExpiresAt: new Date(Date.now() + 60000),
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('regression: inactive account without subscription is rejected with 403', async () => {
  const inactiveStudent = {
    ...studentBase,
    status: 'Inactive',
    accountStatus: 'Approved',
    isActive: false,
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(inactiveStudent) }));
  assert.equal(res.status, 403);
  assert.match(res.error, /active account or subscription is required/i);
});

test('subscription expiry: Active + Approved + expired subscription date = 200', async () => {
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'Active',
    subscriptionExpiresAt: new Date(Date.now() - 10000),
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('subscription expiry: Active + Approved + subscriptionStatus Expired = 200', async () => {
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'Expired',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('subscription expiry: Inactive + expired subscription = 403', async () => {
  const student = {
    ...studentBase,
    status: 'Inactive',
    accountStatus: 'Approved',
    isApproved: true,
    isActive: false,
    subscriptionStatus: 'Active',
    subscriptionExpiresAt: new Date(Date.now() - 10000),
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 403);
  assert.match(res.error, /subscription has expired/i);
});

test('subscription expiry: Pending + expired subscription = 403', async () => {
  const student = {
    ...studentBase,
    status: 'Pending',
    accountStatus: 'Pending',
    isApproved: false,
    isActive: false,
    subscriptionStatus: 'Expired',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 403);
  assert.match(res.error, /subscription has expired/i);
});

test('subscription expiry: Active + Approved + no subscription = 200', async () => {
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('subscription expiry: Valid subscription with otherwise ineligible account = 200', async () => {
  const student = {
    ...studentBase,
    status: 'Pending',
    accountStatus: 'Pending',
    isApproved: false,
    isActive: false,
    subscriptionStatus: 'Active',
    subscriptionExpiresAt: new Date(Date.now() + 60000),
  };
  const res = await resolveStudentLessonVideoAccess(request({ models: mocks(student) }));
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-1');
});

test('regression: multi-course enrollment with primary CRS-000080 and requested CRS-000070 is allowed when verified', async () => {
  const multiCourse = {
    _id: '507f1f77bcf86cd799439070',
    courseId: 'CRS-000070',
    status: 'Published',
    modules: [{
      lessons: [{
        _id: 'lesson-pharm-4',
        videoS3Key: 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
      }],
    }],
  };
  const multiStudent = {
    _id: '507f1f77bcf86cd799439022',
    userId: '507f1f77bcf86cd799439021',
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'None',
    subscriptionExpiresAt: null,
    courseId: 'CRS-000080',
    courseIds: ['CRS-000080', 'CRS-000066', 'CRS-000070'],
  };
  const multiUser = {
    role: 'student',
    id: '507f1f77bcf86cd799439021',
    studentId: '507f1f77bcf86cd799439022',
    courseId: 'CRS-000080',
    courseIds: ['CRS-000080', 'CRS-000066', 'CRS-000070'],
  };
  const res = await resolveStudentLessonVideoAccess({
    user: multiUser,
    courseId: 'CRS-000070',
    s3Key: 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
    models: mocks(multiStudent, multiCourse),
  });
  assert.equal(res.status, 200);
  assert.equal(res.lesson._id, 'lesson-pharm-4');
  assert.equal(res.course.courseId, 'CRS-000070');

  // When student record only has primary course, but authoritative User DB record has CRS-000070 in courseIds
  const studentLegacyOnly = {
    ...multiStudent,
    courseId: 'CRS-000080',
    courseIds: ['CRS-000080'],
  };
  const dbUserRecord = {
    _id: '507f1f77bcf86cd799439021',
    courseId: 'CRS-000080',
    courseIds: ['CRS-000080', 'CRS-000066', 'CRS-000070'],
  };
  const query = (value) => ({ lean: async () => value });
  const multiModelsWithDbUser = {
    Student: { findById: () => query(studentLegacyOnly), findOne: () => query(studentLegacyOnly) },
    User: { findById: () => query(dbUserRecord), findOne: () => query(dbUserRecord) },
    Course: { findOne: () => query(multiCourse), find: () => query([multiCourse]) },
  };
  const resFromUserDb = await resolveStudentLessonVideoAccess({
    user: multiUser,
    courseId: 'CRS-000070',
    s3Key: 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
    models: multiModelsWithDbUser,
  });
  assert.equal(resFromUserDb.status, 200);
  assert.equal(resFromUserDb.lesson._id, 'lesson-pharm-4');

  // Stale JWT courseIds without database enrollment in either Student or User collection must be rejected with 403
  const staleJwtUser = {
    ...multiUser,
    courseIds: ['CRS-000080', 'CRS-000070'], // claims CRS-000070 in JWT
  };
  const dbUserWithoutEnrollment = {
    _id: '507f1f77bcf86cd799439021',
    courseId: 'CRS-000080',
    courseIds: ['CRS-000080'], // DB only has CRS-000080
  };
  const staleModels = {
    Student: { findById: () => query(studentLegacyOnly), findOne: () => query(studentLegacyOnly) },
    User: { findById: () => query(dbUserWithoutEnrollment), findOne: () => query(dbUserWithoutEnrollment) },
    Course: { findOne: () => query(multiCourse), find: () => query([multiCourse]) },
  };
  const resStaleJwt = await resolveStudentLessonVideoAccess({
    user: staleJwtUser,
    courseId: 'CRS-000070',
    s3Key: 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
    models: staleModels,
  });
  assert.equal(resStaleJwt.status, 403);
  assert.match(resStaleJwt.error, /do not have access to this course/i);
});

test('regression: unauthorized course returns 403', async () => {
  const unauthorizedCourse = {
    _id: '507f1f77bcf86cd799439099',
    courseId: 'CRS-000099',
    status: 'Published',
    modules: [{ lessons: [{ _id: 'lesson-99', videoS3Key: 'videos/secret.mp4' }] }],
  };
  const student = {
    ...studentBase,
    status: 'Active',
    accountStatus: 'Approved',
    subscriptionStatus: 'None',
    courseIds: ['CRS-000070'],
  };
  const user = {
    role: 'student',
    id: '507f1f77bcf86cd799439011',
    studentId: '507f1f77bcf86cd799439012',
    courseIds: ['CRS-000070'],
  };
  const res = await resolveStudentLessonVideoAccess({
    user,
    courseId: 'CRS-000099',
    s3Key: 'videos/secret.mp4',
    models: mocks(student, unauthorizedCourse),
  });
  assert.equal(res.status, 403);
  assert.match(res.error, /do not have access to this course/i);
});

test('regression: invalid or unrelated S3 key returns 400 or 403', async () => {
  // Invalid s3Key (empty)
  const resEmpty = await resolveStudentLessonVideoAccess(request({ s3Key: '' }));
  assert.equal(resEmpty.status, 400);

  // Invalid s3Key (newline injection attempt)
  const resInjection = await resolveStudentLessonVideoAccess(request({ s3Key: 'videos/test.mp4\r\n' }));
  assert.equal(resInjection.status, 400);

  // Unrelated S3 key when requested without courseId and student has no authorized course matching key
  const query = (value) => ({ lean: async () => value });
  const noMatchModels = {
    Student: { findById: () => query(studentBase), findOne: () => query(studentBase) },
    Course: {
      findOne: () => query(null),
      find: () => query([]),
    },
  };
  const resUnrelated = await resolveStudentLessonVideoAccess(request({
    courseId: undefined,
    s3Key: 'videos/unrelated-unknown.mp4',
    models: noMatchModels,
  }));
  assert.equal(resUnrelated.status, 403);
  assert.match(resUnrelated.error, /not found in an authorized course lesson/i);
});
