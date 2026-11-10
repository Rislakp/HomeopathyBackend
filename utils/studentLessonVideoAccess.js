const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const Course = require('../models/Course');

function hasCourseEnrollment(student, course, dbUser) {
  if (!course) return false;

  const rawEnrolled = [
    ...(student && Array.isArray(student.courseIds) ? student.courseIds : []),
    student?.courseId,
    student?.courseRef,
    // `course` is a legacy course-title enrollment field. The shared
    // course-access helper has historically treated it as an enrollment alias.
    student?.course,
    ...(dbUser && Array.isArray(dbUser.courseIds) ? dbUser.courseIds : []),
    dbUser?.courseId,
    dbUser?.courseRef,
    dbUser?.course,
  ];

  const enrolledIds = rawEnrolled
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  const courseIds = [course._id, course.courseId, course.courseTitle, course.title]
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  return courseIds.some((id) => enrolledIds.includes(id));
}

/**
 * Shared eligibility gate for student APIs that return course media.
 * Playback is permitted when:
 * 1. The account is Active AND Approved (regardless of whether subscription is None, Expired, or has an old expiry timestamp).
 * OR
 * 2. A student who is not Active + Approved holds an active, non-expired subscription.
 *
 * Expired or invalid subscription timestamps invalidate subscription-based eligibility,
 * but do not override independently valid account-based eligibility.
 * Legacy subscription labels are retained for existing student records.
 */
function getStudentPlaybackEligibilityError(student, now = Date.now()) {
  if (!student) return 'Student profile is required.';

  // Check account operational and approval status
  const status = String(student.status || '').trim().toLowerCase();
  const accountStatus = String(student.accountStatus || '').trim().toLowerCase();

  // Operational status must be active or trial (explicitly reject inactive, pending, suspended, expired, etc.)
  const isOperational = ['active', 'trial'].includes(status) && status !== 'inactive';

  // Approval requires approved/active status, or isApproved flag without contradictory pending/rejected/suspended status
  const isApproved = ['approved', 'active'].includes(accountStatus) ||
    (student.isApproved === true && !['rejected', 'suspended', 'pending'].includes(accountStatus));

  // Both operational status AND approval status must be satisfied for account-based eligibility
  const accountOk = isOperational && isApproved;

  // If the student account is Active + Approved, account eligibility grants playback access.
  if (accountOk) {
    return null;
  }

  // Otherwise, the student must have a valid, active, non-expired subscription
  const subscriptionStatus = String(student.subscriptionStatus || '').trim().toLowerCase();
  const legacySubscription = String(student.subscription || '').trim().toLowerCase();
  const hasActiveSubscriptionStatus = ['active', 'trial'].includes(subscriptionStatus) ||
    ['active', 'trial', 'vip', 'premium'].includes(legacySubscription);

  const expiry = student.subscriptionExpiresAt ? new Date(student.subscriptionExpiresAt) : null;
  const isExpired = subscriptionStatus === 'expired' ||
    (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now));

  if (isExpired && (hasActiveSubscriptionStatus || subscriptionStatus === 'expired')) {
    return 'Course subscription has expired.';
  }

  const validSubscription = hasActiveSubscriptionStatus && !isExpired;
  if (!validSubscription) {
    return 'An active account or subscription is required.';
  }

  return null;
}

async function resolveStudentLessonVideoAccess({ user, courseId, s3Key, models = {} }) {
  const StudentModel = models.Student || Student;
  const UserModel = models.User || User;
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

  // Fetch authoritative User document if available to check authoritative course enrollment
  let dbUser = null;
  if (models.User) {
    const authUserId = student.userId || user.id || user.userId;
    if (authUserId) {
      if (mongoose.Types.ObjectId.isValid(authUserId) && typeof models.User.findById === 'function') {
        const res = models.User.findById(authUserId);
        dbUser = await (res && typeof res.lean === 'function' ? res.lean() : res);
      }
      if (!dbUser && typeof models.User.findOne === 'function') {
        const query = mongoose.Types.ObjectId.isValid(authUserId)
          ? { $or: [{ _id: authUserId }, { userId: authUserId }] }
          : { userId: authUserId };
        const res = models.User.findOne(query);
        dbUser = await (res && typeof res.lean === 'function' ? res.lean() : res);
      }
    }
  } else if (mongoose.connection?.readyState === 1 && User) {
    const authUserId = student.userId || user.id || user.userId;
    if (authUserId) {
      if (mongoose.Types.ObjectId.isValid(authUserId)) {
        dbUser = await User.findById(authUserId).lean();
      }
      if (!dbUser) {
        dbUser = await User.findOne({ userId: authUserId }).lean();
      }
    }
  }

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
        ...(dbUser && Array.isArray(dbUser.courseIds) ? dbUser.courseIds : []),
        student.courseId, student.courseRef, student.course,
        dbUser?.courseId, dbUser?.courseRef, dbUser?.course,
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
    if (!hasCourseEnrollment(student, course, dbUser)) return { status: 403, error: 'You do not have access to this course.' };
  }

  let authorizedCourseCount = 0;
  const matches = [];
  for (const course of courses || []) {
    if (String(course.status || 'Published').toLowerCase() !== 'published') continue;
    if (!hasCourseEnrollment(student, course, dbUser)) continue;
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
