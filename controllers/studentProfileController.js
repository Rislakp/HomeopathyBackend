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
  if (!targetId || targetId === 'profile' || targetId === 'me' || targetId === 'self') return true;
  const userId = req.user?.id || req.user?.userId;
  const studentId = req.user?.studentId;
  return userId === targetId || studentId === targetId;
};

/**
 * Build the sanitized profile response object (no password) with dynamic progress metrics.
 */
const buildProfileResponse = async (user, studentDoc = null) => {
  const courseRef = (studentDoc && studentDoc.courseRef) || user.courseRef || null;
  const courseId = (studentDoc && studentDoc.courseId) || user.courseId || (courseRef ? courseRef.toString() : '');
  const courseTitle = (studentDoc && studentDoc.course) || user.course || user.preferredCourse || '';
  const resolvedPhone = (studentDoc && (studentDoc.phone || studentDoc.contactNumber)) || user.phone || user.contactNumber || '';
  const canonicalId = (user && user._id) ? user._id.toString() : ((studentDoc && studentDoc._id) ? studentDoc._id.toString() : (user.id || ''));

  const base = {
    _id: canonicalId,
    id: canonicalId,
    name: (studentDoc && studentDoc.name) || user.name || '',
    email: (studentDoc && studentDoc.email) || user.email || '',
    role: (user.role || 'student').toLowerCase().trim(),
    phone: resolvedPhone,
    contactNumber: resolvedPhone,
    registeredCourseId: courseId || '',
    courseId: courseId || '',
    course: courseTitle,
    preferredCourse: user.preferredCourse || courseTitle,
    courseRef: courseRef ? courseRef.toString() : null,
    dateOfBirth: (studentDoc && studentDoc.dateOfBirth) || user.dateOfBirth || '',
    qualification: (studentDoc && studentDoc.qualification) || user.qualification || '',
    subscription: (studentDoc && studentDoc.subscription) || 'Free',
    subscriptionStatus: (studentDoc && studentDoc.subscriptionStatus) || user.subscriptionStatus || (studentDoc && studentDoc.subscription ? 'Active' : 'None'),
    subscriptionExpiresAt: (studentDoc && studentDoc.subscriptionExpiresAt) || null,
    status: (studentDoc && studentDoc.status) || user.status || 'Active',
    accountStatus: (studentDoc && studentDoc.accountStatus) || user.accountStatus || 'Approved',
    isApproved: (studentDoc && studentDoc.isApproved !== undefined) ? studentDoc.isApproved : (user.isApproved !== undefined ? user.isApproved : true),
    profileImage: (studentDoc && (studentDoc.profileImage || studentDoc.avatar)) || user.profileImage || user.avatar || '',
    examScores: (studentDoc && studentDoc.examScores) || [],
    courses: [],
    createdAt: (user && user.createdAt) || (studentDoc && studentDoc.createdAt) || new Date(),
    updatedAt: (user && user.updatedAt) || (studentDoc && studentDoc.updatedAt) || new Date(),
  };

  if (studentDoc) {
    base.studentProfileId = studentDoc._id
      ? studentDoc._id.toString()
      : studentDoc.id;
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
// GET /api/students/profile
// GET /api/students/profile/:id
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @route   GET /api/students/profile
 * @route   GET /api/students/profile/:id
 * @desc    Fetch a student's full profile (User + Student doc merged)
 * @access  Private — student (own profile) or admin
 */
const getProfile = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    let targetId = req.params?.id;

    // If param is omitted, or matches route keyword aliases, resolve to authenticated caller
    if (!targetId || targetId === 'profile' || targetId === 'me' || targetId === 'self') {
      targetId = req.user?.id || req.user?.userId || req.user?.studentId;
    }

    if (!isAuthorized(req, targetId)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view your own profile.',
      });
    }

    let user = null;
    let studentDoc = null;

    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      user = await User.findById(targetId).select('-password');
      if (!user && Student) {
        studentDoc = await Student.findById(targetId);
        if (studentDoc) {
          user = await User.findOne({
            $or: [
              ...(studentDoc.userId ? [{ _id: studentDoc.userId }] : []),
              ...(studentDoc.email ? [{ email: studentDoc.email.toLowerCase().trim() }] : [])
            ]
          }).select('-password');
        }
      }
    }

    // Fallback: lookup by authenticated user ID if different from targetId
    if (!user && req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
      user = await User.findById(req.user.id).select('-password');
    }

    // Fallback: lookup by authenticated email
    if (!user && req.user?.email) {
      user = await User.findOne({ email: req.user.email.toLowerCase().trim() }).select('-password');
    }

    // Try to fetch supplementary Student document
    if (user && !studentDoc && Student) {
      studentDoc =
        (await Student.findOne({ userId: user._id })) ||
        (await Student.findOne({ email: user.email.toLowerCase().trim() }));
    }

    // Synthesize user wrapper if student document exists alone
    if (!user && studentDoc) {
      user = {
        _id: studentDoc._id,
        id: studentDoc._id.toString(),
        name: studentDoc.name || '',
        email: studentDoc.email || '',
        role: 'student',
        phone: studentDoc.phone || studentDoc.contactNumber || '',
        contactNumber: studentDoc.contactNumber || studentDoc.phone || '',
        course: studentDoc.course || '',
        courseId: studentDoc.courseId || '',
        registeredCourseId: studentDoc.courseId || '',
        courseRef: studentDoc.courseRef || null,
        dateOfBirth: studentDoc.dateOfBirth || '',
        qualification: studentDoc.qualification || '',
        subscription: studentDoc.subscription || 'Free',
        subscriptionStatus: studentDoc.subscriptionStatus || 'Active',
        status: studentDoc.status || 'Active',
        accountStatus: studentDoc.accountStatus || 'Approved',
        isApproved: studentDoc.isApproved !== undefined ? studentDoc.isApproved : true,
        createdAt: studentDoc.createdAt || new Date(),
        updatedAt: studentDoc.updatedAt || new Date(),
      };
    }

    if (!user && !studentDoc) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.',
      });
    }

    // Verify caller role and permissions
    const callerRole = (req.user?.role || '').toLowerCase().trim();
    const isAdmin = callerRole === 'admin' || callerRole === 'superadmin';
    if (!isAdmin) {
      const reqUserId = (req.user?.id || req.user?.userId || '').toString();
      const reqStudentId = (req.user?.studentId || '').toString();
      const userDocId = user?._id ? user._id.toString() : '';
      const studentDocId = studentDoc?._id ? studentDoc._id.toString() : '';
      const userEmail = (user?.email || '').toLowerCase().trim();
      const callerEmail = (req.user?.email || '').toLowerCase().trim();

      const isOwn = (
        !req.params?.id ||
        req.params.id === 'profile' ||
        req.params.id === 'me' ||
        req.params.id === 'self' ||
        req.params.id === reqUserId ||
        req.params.id === reqStudentId ||
        req.params.id === userDocId ||
        req.params.id === studentDocId ||
        (callerEmail && userEmail && callerEmail === userEmail)
      );

      if (!isOwn) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only view your own profile.',
        });
      }
    }

    const profile = await buildProfileResponse(user, studentDoc);

    return res.status(200).json({
      success: true,
      message: 'Student profile fetched successfully',
      ...profile,
      profile,
      data: profile,
      user: profile,
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
    const mongoose = require('mongoose');
    let targetId = req.params?.id;

    if (!targetId || targetId === 'profile' || targetId === 'me' || targetId === 'self') {
      targetId = req.user?.id || req.user?.userId || req.user?.studentId;
    }

    if (!isAuthorized(req, targetId)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update your own profile.',
      });
    }

    let user = null;
    let studentDoc = null;

    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      user = await User.findById(targetId);
      if (!user && Student) {
        studentDoc = await Student.findById(targetId);
        if (studentDoc) {
          user = await User.findOne({
            $or: [
              ...(studentDoc.userId ? [{ _id: studentDoc.userId }] : []),
              ...(studentDoc.email ? [{ email: studentDoc.email.toLowerCase().trim() }] : [])
            ]
          });
        }
      }
    }

    if (!user && req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
      user = await User.findById(req.user.id);
    }
    if (!user && req.user?.email) {
      user = await User.findOne({ email: req.user.email.toLowerCase().trim() });
    }

    if (!user && !studentDoc) {
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
      'course',
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

    if (req.body.preferredCourse !== undefined || req.body.course !== undefined) {
      const prefCourse = (req.body.preferredCourse || req.body.course || '').toString().trim();
      updates.preferredCourse = prefCourse;
      updates.course = prefCourse;
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
    if (user) {
      Object.assign(user, updates);
      await user.save();
    }

    // Mirror the same updates to the Student document (if it exists)
    if (Student) {
      if (!studentDoc && user) {
        studentDoc =
          (await Student.findOne({ userId: user._id })) ||
          (await Student.findOne({ email: user.email }));
      }

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
        if (updates.preferredCourse !== undefined) {
          studentUpdates.preferredCourse = updates.preferredCourse;
          studentUpdates.course = updates.preferredCourse;
        }

        Object.assign(studentDoc, studentUpdates);
        await studentDoc.save();
      }
    }

    // Re-fetch updated user (without password) for the response
    const resolvedId = (user && user._id) || (studentDoc && studentDoc._id);
    const updatedUser = user ? await User.findById(user._id).select('-password') : null;

    if (Student && !studentDoc && updatedUser) {
      studentDoc =
        (await Student.findOne({ userId: updatedUser._id })) ||
        (await Student.findOne({ email: updatedUser.email }));
    }

    const finalProfile = await buildProfileResponse(updatedUser || user || studentDoc, studentDoc);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      ...finalProfile,
      profile: finalProfile,
      data: finalProfile,
      user: finalProfile,
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
    const mongoose = require('mongoose');
    let targetId = req.params?.id;
    if (!targetId || targetId === 'profile' || targetId === 'me' || targetId === 'self') {
      targetId = req.user?.id || req.user?.userId || req.user?.studentId;
    }
    const hardDelete = req.query.hard === 'true';
    const callerRole = (req.user?.role || '').toLowerCase().trim();
    const isAdmin = callerRole === 'admin' || callerRole === 'superadmin';

    if (!isAuthorized(req, targetId)) {
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

    let user = null;
    let studentDoc = null;

    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      user = await User.findById(targetId);
      if (!user && Student) {
        studentDoc = await Student.findById(targetId);
        if (studentDoc) {
          user = await User.findOne({
            $or: [
              ...(studentDoc.userId ? [{ _id: studentDoc.userId }] : []),
              ...(studentDoc.email ? [{ email: studentDoc.email.toLowerCase().trim() }] : [])
            ]
          });
        }
      }
    }

    if (!user && req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
      user = await User.findById(req.user.id);
    }

    if (!user && !studentDoc) {
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
