const mongoose = require('mongoose');
const Student = require('../models/Student');
const Course = require('../models/Course');

function hasCourseEnrollment(student, course) {
  const enrolledIds = [
    ...(Array.isArray(student.courseIds) ? student.courseIds : []),
    student.courseId,
    student.courseRef,
  ]
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  const courseIds = [course._id, course.courseId]
    .filter((id) => id !== undefined && id !== null && String(id).trim())
    .map((id) => String(id).trim().toLowerCase());

  return courseIds.some((id) => enrolledIds.includes(id));
}

async function resolveStudentLessonVideoAccess({ user, courseId, s3Key, models = {} }) {
  const StudentModel = models.Student || Student;
  const CourseModel = models.Course || Course;
  if (!user || (user.role || '').toLowerCase() !== 'student') return { status: 401, error: 'Student authentication required.' };
  if (typeof s3Key !== 'string' || !s3Key.trim() || s3Key.length > 1024 || /[\r\n]/.test(s3Key)) return { status: 400, error: 'A valid s3Key is required.' };
  if (!courseId || typeof courseId !== 'string') return { status: 400, error: 'courseId is required.' };

  const studentId = user.studentId || user.id || user.userId;
  let student = null;
  if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
    student = await StudentModel.findById(studentId).lean();
    if (!student) student = await StudentModel.findOne({ userId: studentId }).lean();
  }
  if (!student && user.email) student = await StudentModel.findOne({ email: String(user.email).toLowerCase() }).lean();
  if (!student) return { status: 403, error: 'Student profile is required.' };

  const accountOk = ['Active', 'Trial'].includes(student.status) &&
    (!student.accountStatus || ['Approved', 'Active'].includes(student.accountStatus)) &&
    (student.isActive === true || student.isApproved === true || ['Active', 'Trial'].includes(student.status));
  if (!accountOk) return { status: 403, error: 'Student account is not active.' };
  const subStatus = String(student.subscriptionStatus || '').toLowerCase();
  const legacySub = String(student.subscription || '').toLowerCase();
  const expiry = student.subscriptionExpiresAt ? new Date(student.subscriptionExpiresAt) : null;
  if (['inactive', 'expired', 'none'].includes(subStatus)) return { status: 403, error: 'An active subscription is required.' };
  const subscriptionOk = ['active', 'trial'].includes(subStatus) || ['active', 'trial', 'vip', 'premium'].includes(legacySub);
  if (!subscriptionOk || (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()))) {
    return { status: 403, error: 'An active subscription is required.' };
  }

  const courseQuery = [{ courseId: courseId.trim() }];
  if (mongoose.Types.ObjectId.isValid(courseId)) courseQuery.push({ _id: courseId });
  const course = await CourseModel.findOne({ $or: courseQuery }).lean();
  if (!course || String(course.status || 'Published').toLowerCase() !== 'published') return { status: 404, error: 'Course not found.' };
  if (!hasCourseEnrollment(student, course)) {
    return { status: 403, error: 'You do not have access to this course.' };
  }

  const requested = s3Key.trim();
  const directFields = ['videoS3Key', 's3Key', 'mp4S3Key', 'm4vS3Key'];
  const resources = [];
  for (const mod of course.modules || []) for (const lesson of mod.lessons || []) {
    const keys = directFields.map((f) => lesson[f]).filter(Boolean).map(String);
    for (const part of lesson.videoParts || []) {
      for (const field of ['s3Key', 'mp4S3Key', 'm4vS3Key']) if (part[field]) keys.push(String(part[field]));
    }
    if (keys.includes(requested)) resources.push({ lesson, key: requested });
  }
  if (resources.length !== 1) return { status: 404, error: 'Video was not found in the requested course lesson.' };
  return { status: 200, student, course, lesson: resources[0].lesson, key: requested };
}

module.exports = { resolveStudentLessonVideoAccess };
