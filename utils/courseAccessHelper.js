const mongoose = require('mongoose');
const Student = require('../models/Student');

/**
 * Collect all enrolled course identifiers for a student document into a Set.
 * Handles the multi-course array (courseIds), legacy single-course (courseId),
 * courseRef (ObjectId), and course title string for backward compatibility.
 *
 * @param {Object} student - Mongoose Student document or plain object
 * @returns {Set<string>} Set of lowercased/trimmed course ID strings
 */
function collectEnrolledIds(student) {
  const ids = new Set();
  if (!student) return ids;

  // Multi-course array (primary new field)
  if (Array.isArray(student.courseIds)) {
    student.courseIds.forEach((id) => {
      const s = String(id || '').trim();
      if (s) ids.add(s.toLowerCase());
    });
  }

  // Legacy single-course fields (backward compatibility)
  if (student.courseId) {
    ids.add(String(student.courseId).trim().toLowerCase());
  }
  if (student.courseRef) {
    ids.add(String(student.courseRef).trim().toLowerCase());
  }
  if (student.course) {
    ids.add(String(student.course).trim().toLowerCase());
  }

  return ids;
}

/**
 * Validates if the given student profile has access to the requested course.
 *
 * Access is granted if:
 *  - Requester is admin/superadmin (always allowed)
 *  - The requestedCourseId matches any of the student's enrolled course IDs
 *    (checked against: courseIds array, courseId string, courseRef ObjectId,
 *     course title, OR their corresponding Course document's courseId/courseTitle)
 *
 * NOTE: Subscription-based blanket access has been intentionally removed.
 * Course isolation is now enforced strictly via the student's courseIds array.
 * Existing students with only courseId/courseRef continue to work (backward compat).
 *
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

  const targetStr = String(requestedCourseId || '').trim().toLowerCase();
  if (!targetStr) return false;

  // Student needs a valid user/student ID
  const userId = reqUser.id || reqUser.userId;
  if (!userId) return false;

  // ── Resolve Student Document ────────────────────────────────────────────────
  const isObjId = (id) => id && mongoose.Types.ObjectId.isValid(id);
  let student = null;

  if (isObjId(reqUser.studentId)) {
    student = await Student.findById(reqUser.studentId).lean();
  }
  if (!student && isObjId(userId)) {
    student = await Student.findOne({ userId }).lean();
    if (!student) {
      student = await Student.findById(userId).lean();
    }
  }
  if (!student && reqUser.email) {
    student = await Student.findOne({ email: reqUser.email.toLowerCase() }).lean();
  }

  if (!student) return false;

  // ── Primary check: match against all enrolled IDs ──────────────────────────
  const enrolledIds = collectEnrolledIds(student);

  if (enrolledIds.has(targetStr)) return true;

  // ── Extended check: resolve Course documents for ObjectId / custom courseId pairs ──
  // This handles the case where the student has courseRef (ObjectId) but the
  // exam stores the human-readable courseId string, or vice versa.
  const CourseModel = (() => {
    try { return mongoose.models.Course || require('../models/Course'); } catch (e) { return null; }
  })();

  if (!CourseModel) return false;

  // Collect all unique raw enrolled ID values (before lowercasing) for DB query
  const rawIds = [];
  if (Array.isArray(student.courseIds)) {
    student.courseIds.forEach((id) => { if (id) rawIds.push(String(id).trim()); });
  }
  if (student.courseId) rawIds.push(String(student.courseId).trim());
  if (student.courseRef) rawIds.push(String(student.courseRef).trim());
  if (student.course) rawIds.push(String(student.course).trim());

  if (rawIds.length > 0) {
    try {
      const objIds = rawIds.filter(id => isObjId(id)).map(id => new mongoose.Types.ObjectId(id));
      const courseOrConditions = [
        ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
        { courseId: { $in: rawIds } },
        { courseTitle: { $in: rawIds } },
      ];

      const enrolledCourses = await CourseModel.find({ $or: courseOrConditions })
        .select('_id courseId courseTitle')
        .lean();

      for (const c of enrolledCourses) {
        const courseObjIdStr = c._id ? c._id.toString().toLowerCase() : '';
        const courseCourseId = c.courseId ? String(c.courseId).trim().toLowerCase() : '';
        const courseTitleStr = c.courseTitle ? String(c.courseTitle).trim().toLowerCase() : '';

        if (
          targetStr === courseObjIdStr ||
          targetStr === courseCourseId ||
          targetStr === courseTitleStr
        ) {
          return true;
        }
      }

      // Also check: if requestedCourseId is an ObjectId or courseId, look up that course
      // and see if any of its identifiers appear in the student's enrolled set
      const targetObjIds = isObjId(requestedCourseId)
        ? [new mongoose.Types.ObjectId(requestedCourseId)]
        : [];
      const targetCourseOrConditions = [
        ...(targetObjIds.length > 0 ? [{ _id: { $in: targetObjIds } }] : []),
        { courseId: String(requestedCourseId).trim() },
        { courseTitle: String(requestedCourseId).trim() },
      ];
      const targetCourse = await CourseModel.findOne({ $or: targetCourseOrConditions })
        .select('_id courseId courseTitle')
        .lean();

      if (targetCourse) {
        const tId = targetCourse._id ? targetCourse._id.toString().toLowerCase() : '';
        const tCourseId = targetCourse.courseId ? String(targetCourse.courseId).trim().toLowerCase() : '';
        const tTitle = targetCourse.courseTitle ? String(targetCourse.courseTitle).trim().toLowerCase() : '';

        if (enrolledIds.has(tId) || enrolledIds.has(tCourseId) || enrolledIds.has(tTitle)) {
          return true;
        }
      }
    } catch (err) {
      // Lookup error — fail closed (deny access)
      console.warn('[courseAccessHelper] Extended course lookup error:', err.message);
    }
  }

  return false;
}

/** Grant access when the student is enrolled in at least one assigned course. */
async function verifyStudentCourseAccessAny(reqUser, requestedCourseIds) {
  const seen = new Set();
  const ids = (Array.isArray(requestedCourseIds) ? requestedCourseIds : [requestedCourseIds])
    .map((value) => String(value || '').trim())
    .filter((id) => {
      const key = id.toLowerCase();
      if (!id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  for (const courseId of ids) {
    if (await verifyStudentCourseAccess(reqUser, courseId)) return true;
  }
  return false;
}

/**
 * Get the normalized list of enrolled course IDs for a student.
 * Used by controllers to build multi-course exam/content filters.
 *
 * Returns an object with:
 *  - rawIds: string[] — all raw enrolled IDs (courseIds, courseId, courseRef, course)
 *  - objectIds: ObjectId[] — only valid ObjectIds from the list
 *  - stringIds: string[] — all non-ObjectId string IDs
 *
 * @param {Object} student - Mongoose Student document or plain object
 * @returns {{ rawIds: string[], objectIds: ObjectId[], stringIds: string[] }}
 */
function getStudentEnrolledCourseIds(student) {
  if (!student) return { rawIds: [], objectIds: [], stringIds: [] };

  const seen = new Set();
  const rawIds = [];

  const addId = (id) => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    rawIds.push(s);
  };

  // Multi-course array (primary)
  if (Array.isArray(student.courseIds)) {
    student.courseIds.forEach(addId);
  }

  // Legacy single-course backward compat
  if (student.courseId) addId(student.courseId);
  if (student.courseRef) addId(String(student.courseRef));
  if (student.course) addId(student.course);

  const objectIds = rawIds
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id));

  const stringIds = rawIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

  return { rawIds, objectIds, stringIds };
}

module.exports = {
  verifyStudentCourseAccess,
  verifyStudentCourseAccessAny,
  getStudentEnrolledCourseIds,
  collectEnrolledIds,
};
