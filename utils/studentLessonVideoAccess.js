const mongoose = require('mongoose');
const Student = require('../models/Student');
const Course = require('../models/Course');

function hasCourseEnrollment(student, course) {
  const enrolledIds = [
    ...(Array.isArray(student.courseIds) ? student.courseIds : []),
    student.courseId,
    student.courseRef,
    // `course` is a legacy course-title enrollment field. The shared
    // course-access helper has historically treated it as an enrollment alias.
    student.course,
  ]
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  const courseIds = [course._id, course.courseId, course.courseTitle, course.title]
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  return courseIds.some((id) => enrolledIds.includes(id));
}

/**
 * Shared eligibility gate for student APIs that return course media.
 * Account status and subscription status are independent requirements.
 * Legacy subscription labels are retained for existing student records.
 */
function getStudentPlaybackEligibilityError(student, now = Date.now()) {
  if (!student) return 'Student profile is required.';

  const status = String(student.status || '').trim().toLowerCase();
  const accountStatus = String(student.accountStatus || '').trim().toLowerCase();
  const accountOk = ['active', 'trial'].includes(status) &&
    (!accountStatus || ['approved', 'active'].includes(accountStatus));
  if (!accountOk) return 'Student account is not active.';

  const subscriptionStatus = String(student.subscriptionStatus || '').trim().toLowerCase();
  const legacySubscription = String(student.subscription || '').trim().toLowerCase();
  const subscriptionOk = ['active', 'trial'].includes(subscriptionStatus) ||
    ['active', 'trial', 'vip', 'premium'].includes(legacySubscription);
  const expiry = student.subscriptionExpiresAt ? new Date(student.subscriptionExpiresAt) : null;
  if (!subscriptionOk || (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now))) {
    return 'An active subscription is required.';
  }

  return null;
}

async function resolveStudentLessonVideoAccess({ user, courseId, s3Key, models = {} }) {
  const StudentModel = models.Student || Student;
  const CourseModel = models.Course || Course;
  if (!user || (user.role || '').toLowerCase() !== 'student') return { status: 401, error: 'Student authentication required.' };
  if (typeof s3Key !== 'string' || !s3Key.trim() || s3Key.length > 1024 || /[\r\n]/.test(s3Key)) return { status: 400, error: 'A valid s3Key is required.' };
  if (courseId != null && typeof courseId !== 'string') return { status: 400, error: 'Invalid courseId.' };
  const requestedCourseId = typeof courseId === 'string' ? courseId.trim() : '';

  const studentId = user.studentId || user.id || user.userId;
  let student = null;
  if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
    student = await StudentModel.findById(studentId).lean();
    if (!student) student = await StudentModel.findOne({ userId: studentId }).lean();
  }
  if (!student && user.email) student = await StudentModel.findOne({ email: String(user.email).toLowerCase() }).lean();
  if (!student) return { status: 403, error: 'Student profile is required.' };

  const eligibilityError = getStudentPlaybackEligibilityError(student);
  if (eligibilityError) return { status: 403, error: eligibilityError };

  const requested = s3Key.trim();
  const directFields = ['videoS3Key', 's3Key', 'mp4S3Key', 'm4vS3Key'];
  const candidatesQuery = { $or: [
    { 'modules.lessons.videoS3Key': requested }, { 'modules.lessons.s3Key': requested },
    { 'modules.lessons.mp4S3Key': requested }, { 'modules.lessons.m4vS3Key': requested },
    { 'modules.lessons.videoParts.s3Key': requested }, { 'modules.lessons.videoParts.mp4S3Key': requested },
    { 'modules.lessons.videoParts.m4vS3Key': requested },
  ] };
  let courses;
  if (requestedCourseId) {
    const courseQuery = [
      { courseId: requestedCourseId }, { courseTitle: requestedCourseId }, { title: requestedCourseId },
    ];
    if (mongoose.Types.ObjectId.isValid(requestedCourseId)) courseQuery.push({ _id: requestedCourseId });
    const result = await CourseModel.findOne({ $or: courseQuery });
    const course = result && typeof result.lean === 'function' ? await result.lean() : result;
    courses = course ? [course] : [];
  } else {
    const canQueryMany = mongoose.connection?.readyState === 1 || CourseModel.find !== mongoose.Model.find;
    if (canQueryMany && typeof CourseModel.find === 'function') {
      const result = CourseModel.find(candidatesQuery);
      courses = await (result && typeof result.lean === 'function' ? result.lean() : result);
    } else if (CourseModel.findOne !== mongoose.Model.findOne) {
      const enrolledIds = [
        ...(Array.isArray(student.courseIds) ? student.courseIds : []),
        student.courseId, student.courseRef, student.course,
      ].filter((id) => id !== undefined && id !== null && String(id).trim());
      if (!enrolledIds.length) return { status: 403, error: 'You do not have access to this course.' };
      const enrolledOr = [];
      for (const value of enrolledIds) {
        const id = String(value).trim();
        enrolledOr.push({ courseId: id }, { courseTitle: id }, { title: id });
        if (mongoose.Types.ObjectId.isValid(id)) enrolledOr.push({ _id: id });
      }
      const result = CourseModel.findOne({ $and: [{ $or: enrolledOr }, candidatesQuery] });
      const course = result && typeof result.lean === 'function' ? await result.lean() : await result;
      courses = course ? [course] : [];
    } else {
      return { status: 503, error: 'Course lookup is temporarily unavailable.' };
    }
  }

  if (requestedCourseId) {
    const course = (courses || [])[0];
    if (!course || String(course.status || 'Published').toLowerCase() !== 'published') return { status: 404, error: 'Course not found.' };
    if (!hasCourseEnrollment(student, course)) return { status: 403, error: 'You do not have access to this course.' };
  }

  let authorizedCourseCount = 0;
  const matches = [];
  for (const course of courses || []) {
    if (String(course.status || 'Published').toLowerCase() !== 'published') continue;
    if (!hasCourseEnrollment(student, course)) continue;
    authorizedCourseCount += 1;
    for (const mod of course.modules || []) for (const lesson of mod.lessons || []) {
      const keys = directFields.map((field) => lesson[field]).filter(Boolean).map(String);
      for (const part of lesson.videoParts || []) {
        for (const field of ['s3Key', 'mp4S3Key', 'm4vS3Key']) if (part[field]) keys.push(String(part[field]));
      }
      if (keys.includes(requested)) matches.push({ course, lesson });
    }
  }
  if (matches.length !== 1) {
    return { status: matches.length > 1 ? 409 : (requestedCourseId ? 404 : (authorizedCourseCount > 0 ? 404 : 403)), error: matches.length > 1 ? 'Video matches more than one authorized lesson.' : 'Video was not found in an authorized course lesson.' };
  }
  return { status: 200, student, course: matches[0].course, lesson: matches[0].lesson, key: requested };
}

function findLessonMatchingKey(course, requestedKey) {
  const requested = String(requestedKey || '').trim();
  if (!course || !Array.isArray(course.modules) || !requested) return null;
  for (const mod of course.modules) for (const lesson of mod.lessons || []) {
    const keys = ['videoS3Key', 's3Key', 'mp4S3Key', 'm4vS3Key'].map((field) => lesson[field]).filter(Boolean).map(String);
    for (const part of lesson.videoParts || []) for (const field of ['s3Key', 'mp4S3Key', 'm4vS3Key']) if (part[field]) keys.push(String(part[field]));
    if (keys.includes(requested)) return { lesson, key: requested };
  }
  return null;
}

module.exports = {
  findLessonMatchingKey,
  resolveStudentLessonVideoAccess,
  hasCourseEnrollment,
  getStudentPlaybackEligibilityError,
};
