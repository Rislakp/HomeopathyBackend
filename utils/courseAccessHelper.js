const mongoose = require('mongoose');
const Student = require('../models/Student');

/**
 * Validates if the given student profile has access to the requested course.
 * @param {Object} reqUser - The req.user object (from auth middleware)
 * @param {String|mongoose.Types.ObjectId} requestedCourseId - The course ID being requested
 * @returns {Promise<boolean>} True if authorized, false otherwise
 */
async function verifyStudentCourseAccess(reqUser, requestedCourseId) {
  if (!reqUser) return false;

  // Admins always have access
  const role = (reqUser.role || '').toLowerCase().trim();
  if (['admin', 'superadmin'].includes(role)) {
    return true;
  }

  // Student needs a valid user/student ID
  const userId = reqUser.id || reqUser.userId;
  if (!userId) return false;

  // Resolve Student Document
  const isObjId = (id) => id && mongoose.Types.ObjectId.isValid(id);
  let student = null;

  if (isObjId(reqUser.studentId)) {
    student = await Student.findById(reqUser.studentId);
  }
  if (!student && isObjId(userId)) {
    student = await Student.findOne({ userId });
    if (!student) {
      student = await Student.findById(userId);
    }
  }
  if (!student && reqUser.email) {
    student = await Student.findOne({ email: reqUser.email.toLowerCase() });
  }

  if (!student) return false;

  const targetCourseIdStr = String(requestedCourseId || '').trim();
  if (!targetCourseIdStr) return false;

  // Compare against student.courseRef (ObjectId) and student.courseId (String)
  const studentCourseRefStr = student.courseRef ? student.courseRef.toString() : '';
  const studentCourseIdStr = student.courseId ? String(student.courseId).trim() : '';
  
  if (studentCourseRefStr === targetCourseIdStr) return true;
  if (studentCourseIdStr === targetCourseIdStr) return true;
  if (student.course && student.course.trim().toLowerCase() === targetCourseIdStr.toLowerCase()) return true;
  if (Array.isArray(student.courseIds)) {
    const found = student.courseIds.some(id => String(id).trim().toLowerCase() === targetCourseIdStr.toLowerCase());
    if (found) return true;
  }
  
  // Also check if the requestedCourseId matches the student's assigned courseRef exactly 
  // (if they requested a custom string ID but the student has the ObjectId and vice versa)
  if (studentCourseRefStr) {
    try {
      const Course = require('../models/Course');
      // If student has courseRef, load the course to check its custom courseId
      const course = await Course.findById(studentCourseRefStr);
      if (course && course.courseId && String(course.courseId) === targetCourseIdStr) {
        return true;
      }
    } catch (err) {
      // Ignore
    }
  }
  
  if (studentCourseIdStr) {
    try {
      const Course = require('../models/Course');
      const course = await Course.findOne({ courseId: studentCourseIdStr });
      if (course && course._id.toString() === targetCourseIdStr) {
         return true;
      }
    } catch (err) {
      // Ignore
    }
  }

  // Active / Trial subscribers have full curriculum access to published courses
  if (['Active', 'Trial'].includes(student.subscriptionStatus) || student.subscription === 'Active' || student.subscription === 'VIP' || student.subscription === 'Premium') {
    return true;
  }

  return false;
}

module.exports = {
  verifyStudentCourseAccess,
};
