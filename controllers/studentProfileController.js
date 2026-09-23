const User = require('../models/User');
let Student;
try { Student = require('../models/Student'); } catch (e) { /* optional */ }

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Check whether the authenticated requester is authorized to act on a profile.
 * Students may only access their own profile; admins may access any.
 */
const isAuthorized = (req, targetId) => {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'superadmin') return true;
  return req.user?.id === targetId || req.user?.userId === targetId;
};

/**
 * Build the sanitized profile response object (no password) with dynamic progress metrics.
 */
const buildProfileResponse = async (user, studentDoc = null) => {
  const courseRef = (studentDoc && studentDoc.courseRef) || user.courseRef || null;
  const courseId = (studentDoc && studentDoc.courseId) || user.courseId || (courseRef ? courseRef.toString() : '');
  const courseTitle = (studentDoc && studentDoc.course) || user.course || user.preferredCourse || '';

  const base = {
    id: user._id ? user._id.toString() : user.id,
    name: user.name,
    email: user.email,
    role: (user.role || 'student').toLowerCase().trim(),
    contactNumber: user.contactNumber || user.phone || '',
    phone: user.phone || user.contactNumber || '',
    dateOfBirth: user.dateOfBirth || '',
    qualification: user.qualification || '',
    preferredCourse: user.preferredCourse || '',
    course: courseTitle,
    courseId: courseId,
    courseRef: courseRef ? courseRef.toString() : null,
    courses: [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  if (studentDoc) {
    base.studentProfileId = studentDoc._id
      ? studentDoc._id.toString()
      : studentDoc.id;
    base.course = studentDoc.course || courseTitle;
    base.subscription = studentDoc.subscription || '';
    base.subscriptionStatus = studentDoc.subscriptionStatus || 'None';
    base.subscriptionExpiresAt = studentDoc.subscriptionExpiresAt || null;
    base.status = studentDoc.status || 'Active';
    base.examScores = studentDoc.examScores || [];
  }

  try {
    const Course = require('../models/Course');
    let targetCourse = null;
    if (courseRef && require('mongoose').Types.ObjectId.isValid(courseRef)) {
      targetCourse = await Course.findById(courseRef);
    }
    if (!targetCourse && courseId) {
      if (/^[0-9a-fA-F]{24}$/.test(courseId)) {
        targetCourse = await Course.findById(courseId);
      }
      if (!targetCourse) {
        targetCourse = await Course.findOne({ courseId });
      }
    }
    if (!targetCourse && courseTitle) {
      targetCourse = await Course.findOne({
        $or: [{ courseTitle: courseTitle }, { title: courseTitle }],
      });
    }

    if (targetCourse) {
      const studentId = studentDoc ? studentDoc._id : user._id;
      const ContentItemProgress = require('../models/ContentItemProgress');
      const CourseProgress = require('../models/CourseProgress');
      const { buildProgressSummary } = require('./studentCurriculumController');

      const contentProgressDocs = await ContentItemProgress.find({
        studentId: studentId,
        courseId: targetCourse._id,
      }).lean();

      const storedCourseProgress = await CourseProgress.findOne({
        studentId: studentId,
        courseId: targetCourse._id,
      }).lean();

      const studyTimeSec = storedCourseProgress?.studyTimeSeconds || 0;
      const summary = buildProgressSummary(targetCourse, contentProgressDocs, studyTimeSec);

      const courseItem = {
        id: targetCourse._id.toString(),
        _id: targetCourse._id.toString(),
        courseId: targetCourse.courseId || targetCourse._id.toString(),
        title: targetCourse.courseTitle || courseTitle || 'Assigned Course',
        courseTitle: targetCourse.courseTitle || courseTitle || 'Assigned Course',
        thumbnail: targetCourse.thumbnail || targetCourse.bannerUrl || '',
        bannerUrl: targetCourse.bannerUrl || targetCourse.thumbnail || '',
        totalModules: Array.isArray(targetCourse.modules) ? targetCourse.modules.length : 0,
        totalLessons: summary.totalLessons,
        completedLessons: summary.completedLessons,
        completedLessonIds: summary.completedLessonIds,
        completedItemIds: summary.completedItemIds,
        completionPercentage: summary.completionPercentage,
        progressPercentage: summary.completionPercentage,
        percentage: summary.percentage,
        progress: summary.progress,
        status: summary.status,
        studyTimeSeconds: summary.studyTimeSeconds,
        studyTimeHours: summary.studyTimeHours,
        summary: summary,
        progressSummary: summary,
      };

      base.courses.push(courseItem);
      base.courseProgress = summary;
      base.progress = summary;
      base.completedLessonIds = summary.completedLessonIds;
      base.totalLessons = summary.totalLessons;
      base.completedLessons = summary.completedLessons;
      base.completionPercentage = summary.completionPercentage;
      base.progressPercentage = summary.completionPercentage;
    } else if (courseRef || courseId) {
      base.courses.push({
        id: courseRef ? courseRef.toString() : courseId,
        _id: courseRef ? courseRef.toString() : courseId,
        courseId: courseId,
        title: courseTitle || 'Assigned Course',
        totalLessons: 0,
        completedLessons: 0,
        completedLessonIds: [],
        completionPercentage: 0,
        progressPercentage: 0,
        progress: 0,
        status: 'Not Started',
        studyTimeSeconds: 0,
        studyTimeHours: 0,
      });
    }
  } catch (err) {
    console.warn('Notice: Could not load dynamic progress for profile response:', err.message);
  }

  return base;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/students/profile/:id
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @route   GET /api/students/profile/:id
 * @desc    Fetch a student's full profile (User + Student doc merged)
 * @access  Private — student (own profile) or admin
 */
const getProfile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isAuthorized(req, id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view your own profile.',
      });
    }

    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.',
      });
    }

    // Verify the user is actually a student (unless admin is calling)
    const role = (req.user?.role || '').toLowerCase().trim();
    const targetRole = (user.role || '').toLowerCase().trim();
    if (role !== 'admin' && role !== 'superadmin' && targetRole !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: This endpoint is for student profiles only.',
      });
    }

    // Try to fetch the supplementary Student document
    let studentDoc = null;
    if (Student) {
      studentDoc =
        (await Student.findOne({ userId: user._id })) ||
        (await Student.findOne({ email: user.email }));
    }

    const profile = await buildProfileResponse(user, studentDoc);

    return res.status(200).json({
      success: true,
      profile,
    });
  } catch (error) {
    console.error('[studentProfileController] getProfile Error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching student profile.',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/students/profile/:id
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @route   PATCH /api/students/profile/:id
 * @desc    Update allowed student profile fields
 * @access  Private — student (own profile) or admin
 *
 * Allowed updatable fields:
 *   name, contactNumber, qualification, preferredCourse, dateOfBirth
 */
const updateProfile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isAuthorized(req, id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update your own profile.',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.',
      });
    }

    // Whitelist — only these fields may be changed by the student themselves
    const ALLOWED_FIELDS = [
      'name',
      'contactNumber',
      'phone',
      'dateOfBirth',
      'dob',
      'qualification',
      'preferredCourse',
    ];

    const updates = {};
    const errors = [];

    if (req.body.name !== undefined) {
      const name = req.body.name.toString().trim();
      if (!name) {
        errors.push('Name cannot be empty.');
      } else {
        updates.name = name;
      }
    }

    const newPhone =
      req.body.contactNumber !== undefined
        ? req.body.contactNumber
        : req.body.phone;
    if (newPhone !== undefined) {
      const phone = newPhone.toString().trim();
      if (!phone) {
        errors.push('Contact number cannot be empty.');
      } else {
        updates.contactNumber = phone;
        updates.phone = phone;
      }
    }

    if (req.body.dateOfBirth !== undefined || req.body.dob !== undefined) {
      const dob = (req.body.dateOfBirth || req.body.dob || '').toString().trim();
      updates.dateOfBirth = dob;
    }

    if (req.body.qualification !== undefined) {
      updates.qualification = req.body.qualification.toString().trim();
    }

    if (req.body.preferredCourse !== undefined) {
      updates.preferredCourse = req.body.preferredCourse.toString().trim();
    }

    // Block any attempt to update disallowed fields
    const receivedKeys = Object.keys(req.body);
    const disallowed = receivedKeys.filter((k) => !ALLOWED_FIELDS.includes(k));
    if (disallowed.length > 0) {
      return res.status(400).json({
        success: false,
        message: `These fields cannot be updated via this endpoint: ${disallowed.join(', ')}`,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updatable fields provided.',
      });
    }

    // Apply updates to User document
    Object.assign(user, updates);
    await user.save();

    // Mirror the same updates to the Student document (if it exists)
    if (Student) {
      const studentDoc =
        (await Student.findOne({ userId: user._id })) ||
        (await Student.findOne({ email: user.email }));

      if (studentDoc) {
        const studentUpdates = {};
        if (updates.name) studentUpdates.name = updates.name;
        if (updates.contactNumber) {
          studentUpdates.contactNumber = updates.contactNumber;
          studentUpdates.phone = updates.phone;
        }
        if (updates.dateOfBirth !== undefined)
          studentUpdates.dateOfBirth = updates.dateOfBirth;
        if (updates.qualification !== undefined)
          studentUpdates.qualification = updates.qualification;
        if (updates.preferredCourse !== undefined)
          studentUpdates.preferredCourse = updates.preferredCourse;

        Object.assign(studentDoc, studentUpdates);
        await studentDoc.save();
      }
    }

    // Re-fetch updated user (without password) for the response
    const updatedUser = await User.findById(id).select('-password');

    let studentDoc = null;
    if (Student) {
      studentDoc =
        (await Student.findOne({ userId: updatedUser._id })) ||
        (await Student.findOne({ email: updatedUser.email }));
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      profile: await buildProfileResponse(updatedUser, studentDoc),
    });
  } catch (error) {
    console.error('[studentProfileController] updateProfile Error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format.',
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A duplicate value conflict occurred (email or phone already in use).',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating student profile.',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/students/profile/:id
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @route   DELETE /api/students/profile/:id
 * @desc    Soft-deactivate student account (sets isActive=false on User,
 *          status='Inactive' on Student). Data is preserved.
 *          Pass ?hard=true (admin only) for permanent deletion.
 * @access  Private — student (own account) or admin
 */
const deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const hardDelete = req.query.hard === 'true';
    const callerRole = (req.user?.role || '').toLowerCase().trim();
    const isAdmin = callerRole === 'admin' || callerRole === 'superadmin';

    if (!isAuthorized(req, id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete your own account.',
      });
    }

    // Only admins may hard-delete
    if (hardDelete && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Permanent deletion requires admin privileges.',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.',
      });
    }

    if (hardDelete) {
      // ── HARD DELETE ──────────────────────────────────────────────────────────
      if (Student) {
        await Student.deleteMany({
          $or: [{ userId: user._id }, { email: user.email }],
        });
      }
      await User.findByIdAndDelete(id);

      return res.status(200).json({
        success: true,
        message: 'Student account permanently deleted.',
      });
    }

    // ── SOFT DELETE (default) ──────────────────────────────────────────────────
    // Add isActive field to User model if it doesn't exist; set it false
    user.set('isActive', false, { strict: false });
    await user.save();

    if (Student) {
      const studentDoc =
        (await Student.findOne({ userId: user._id })) ||
        (await Student.findOne({ email: user.email }));

      if (studentDoc) {
        studentDoc.status = 'Inactive';
        studentDoc.isActive = false;
        await studentDoc.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Student account has been deactivated successfully.',
    });
  } catch (error) {
    console.error('[studentProfileController] deleteAccount Error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error during account deletion.',
      error: error.message,
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  deleteAccount,
  buildProfileResponse,
};
