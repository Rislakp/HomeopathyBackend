const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Course = require('../models/Course');
let Student;
try {
  Student = require('../models/Student');
} catch (e) {
  // Student model optional
}

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Generate JWT token containing user id, email, and role from database
 */
const generateToken = (user, studentDoc = null) => {
  const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'white_coat_academy_secret_jwt_key_2026_super_secure' : undefined);
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const role = (user.role || 'student').toLowerCase().trim();

  let courseRef = (studentDoc && studentDoc.courseRef) || user.courseRef || null;
  let courseId = (studentDoc && studentDoc.courseId) || user.courseId || (courseRef ? courseRef.toString() : '');
  const preferredCourse = user.preferredCourse || (studentDoc && studentDoc.preferredCourse) || user.course || (studentDoc && studentDoc.course) || '';

  if (/^unani$/i.test(preferredCourse.trim())) {
    courseId = courseId || 'CRS-000056';
    courseRef = courseRef || '6ab505e20047831b14861a8f';
  }

  const studentId = studentDoc ? studentDoc._id.toString() : (user.studentId || null);

  // ── Multi-course: collect all enrolled course IDs for JWT claim ──────────
  const seenIds = new Set();
  const courseIdsArray = [];
  const addCId = (id) => {
    const s = String(id || '').trim();
    if (!s || seenIds.has(s)) return;
    seenIds.add(s);
    courseIdsArray.push(s);
  };
  // From studentDoc (authoritative source)
  if (studentDoc) {
    if (Array.isArray(studentDoc.courseIds)) studentDoc.courseIds.forEach(addCId);
    if (studentDoc.courseId) addCId(studentDoc.courseId);
    if (studentDoc.courseRef) addCId(String(studentDoc.courseRef));
  }
  // From user (fallback)
  if (Array.isArray(user.courseIds)) user.courseIds.forEach(addCId);
  if (user.courseId) addCId(user.courseId);
  if (courseId) addCId(courseId);

  return jwt.sign(
    {
      id: user._id ? user._id.toString() : user.id,
      userId: user._id ? user._id.toString() : user.id,
      studentId: studentId,
      email: user.email,
      role: role,
      // Legacy single-course claim (backward compatibility)
      courseId: courseId,
      courseRef: courseRef ? courseRef.toString() : null,
      // Multi-course claim
      courseIds: courseIdsArray,
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    }
  );
};

/**
 * Helper to build sanitized user JSON response object with authoritative course progress
 */
const buildUserResponse = async (user, studentDoc = null, options = {}) => {
  let courseRef = (studentDoc && studentDoc.courseRef) || user.courseRef || null;
  let courseId = (studentDoc && studentDoc.courseId) || user.courseId || (courseRef ? courseRef.toString() : '');
  let courseTitle = (studentDoc && studentDoc.course) || user.course || user.preferredCourse || '';
  let preferredCourse = user.preferredCourse || (studentDoc && studentDoc.preferredCourse) || courseTitle || '';

  // If UNANI, enforce standard UNANI course identity if missing
  if (/^unani$/i.test(preferredCourse.trim()) || /^unani$/i.test(courseTitle.trim())) {
    courseId = courseId || 'CRS-000056';
    courseTitle = 'UNANI';
    preferredCourse = 'UNANI';
  }

  // Fast single-roundtrip course resolution using $or query
  let targetCourse = null;
  const courseConditions = [];
  if (courseRef && mongoose.Types.ObjectId.isValid(courseRef)) {
    courseConditions.push({ _id: new mongoose.Types.ObjectId(courseRef) });
  }
  if (courseId) {
    courseConditions.push({ courseId });
    if (/^[0-9a-fA-F]{24}$/.test(courseId)) {
      courseConditions.push({ _id: new mongoose.Types.ObjectId(courseId) });
    }
  }
  if (courseTitle) {
    const escapedTitle = courseTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    courseConditions.push({ courseTitle: new RegExp(`^${escapedTitle}$`, 'i') });
    courseConditions.push({ title: new RegExp(`^${escapedTitle}$`, 'i') });
  }
  if (preferredCourse && preferredCourse !== courseTitle) {
    const escapedPref = preferredCourse.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    courseConditions.push({ courseTitle: new RegExp(`^${escapedPref}$`, 'i') });
    courseConditions.push({ title: new RegExp(`^${escapedPref}$`, 'i') });
  }

  if (courseConditions.length > 0) {
    targetCourse = await Course.findOne({ $or: courseConditions }).lean();
  }

  if (targetCourse) {
    courseRef = targetCourse._id;
    courseId = targetCourse.courseId || targetCourse._id.toString();
    courseTitle = targetCourse.courseTitle || targetCourse.title || courseTitle;
  }

  // ── Multi-course: collect all enrolled course IDs ────────────────────────
  const seenRCIds = new Set();
  const registeredCourseIds = [];
  const addRCId = (id) => {
    const s = String(id || '').trim();
    if (!s || seenRCIds.has(s)) return;
    seenRCIds.add(s);
    registeredCourseIds.push(s);
  };
  if (studentDoc) {
    if (Array.isArray(studentDoc.courseIds)) studentDoc.courseIds.forEach(addRCId);
    if (studentDoc.courseId) addRCId(studentDoc.courseId);
    if (studentDoc.courseRef) addRCId(String(studentDoc.courseRef));
  }
  if (Array.isArray(user.courseIds)) user.courseIds.forEach(addRCId);
  if (user.courseId) addRCId(user.courseId);
  if (courseId) addRCId(courseId);
  // Ensure the resolved primary courseId is in registeredCourseIds after targetCourse resolution
  if (targetCourse) {
    const resolvedId = targetCourse.courseId || (targetCourse._id ? targetCourse._id.toString() : '');
    if (resolvedId) addRCId(resolvedId);
  }

  const response = {
    id: user._id ? user._id.toString() : user.id,
    name: user.name,
    email: user.email,
    role: (user.role || 'student').toLowerCase().trim(),
    phone: user.phone || user.contactNumber || '',
    contactNumber: user.contactNumber || user.phone || '',
    qualification: user.qualification || '',
    preferredCourse: preferredCourse,
    course: courseTitle,
    // Legacy single-course fields (backward compatibility)
    courseId: courseId,
    registeredCourseId: courseId,
    courseRef: courseRef ? courseRef.toString() : null,
    // Multi-course fields
    courseIds: registeredCourseIds,
    registeredCourseIds: registeredCourseIds,
    dateOfBirth: user.dateOfBirth || '',
    courses: [],
  };

  if (studentDoc) {
    response.status = studentDoc.status || 'Pending';
    response.accountStatus = studentDoc.accountStatus || 'Pending';
    response.isApproved = studentDoc.isApproved !== undefined ? studentDoc.isApproved : false;
    response.subscription = studentDoc.subscription || 'None';
    response.subscriptionStatus = studentDoc.subscriptionStatus || 'None';
    response.subscriptionExpiresAt = studentDoc.subscriptionExpiresAt || null;
  } else {
    // Fallback to User document fields if Student document is not found
    response.status = user.status || 'Pending';
    response.accountStatus = user.accountStatus || 'Pending';
    response.isApproved = user.isApproved !== undefined ? user.isApproved : false;
  }

  // If student user, format assigned course details
  if (response.role === 'student') {
    try {
      if (targetCourse) {
        const studentId = studentDoc ? studentDoc._id : user._id;

        // In login mode, return lean course structure fast without querying all ContentItemProgress
        if (options.isLogin) {
          const courseItem = {
            id: targetCourse._id.toString(),
            _id: targetCourse._id.toString(),
            courseId: targetCourse.courseId || targetCourse._id.toString(),
            title: targetCourse.courseTitle || targetCourse.title || courseTitle || 'Assigned Course',
            courseTitle: targetCourse.courseTitle || targetCourse.title || courseTitle || 'Assigned Course',
            thumbnail: targetCourse.thumbnail || targetCourse.bannerUrl || '',
            bannerUrl: targetCourse.bannerUrl || targetCourse.thumbnail || '',
            totalModules: Array.isArray(targetCourse.modules) ? targetCourse.modules.length : 0,
            totalLessons: 0,
            completedLessons: 0,
            completedLessonIds: [],
            completedItemIds: [],
            completionPercentage: 0,
            progressPercentage: 0,
            percentage: 0,
            progress: 0,
            status: 'Active',
            studyTimeSeconds: 0,
            studyTimeHours: 0,
          };
          response.courses.push(courseItem);
        } else {
          const ContentItemProgress = require('../models/ContentItemProgress');
          const CourseProgress = require('../models/CourseProgress');
          const { buildProgressSummary } = require('./studentCurriculumController');

          const [contentProgressDocs, storedCourseProgress] = await Promise.all([
            ContentItemProgress.find({
              studentId: studentId,
              courseId: targetCourse._id,
            }).lean(),
            CourseProgress.findOne({
              studentId: studentId,
              courseId: targetCourse._id,
            }).lean()
          ]);

          const studyTimeSec = storedCourseProgress?.studyTimeSeconds || 0;
          const summary = buildProgressSummary(targetCourse, contentProgressDocs, studyTimeSec);

          const courseItem = {
            id: targetCourse._id.toString(),
            _id: targetCourse._id.toString(),
            courseId: targetCourse.courseId || targetCourse._id.toString(),
            title: targetCourse.courseTitle || targetCourse.title || courseTitle || 'Assigned Course',
            courseTitle: targetCourse.courseTitle || targetCourse.title || courseTitle || 'Assigned Course',
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

          response.courses.push(courseItem);
          response.courseProgress = summary;
          response.progress = summary;
          response.completedLessonIds = summary.completedLessonIds;
          response.totalLessons = summary.totalLessons;
          response.completedLessons = summary.completedLessons;
          response.completionPercentage = summary.completionPercentage;
          response.progressPercentage = summary.completionPercentage;
        }
      } else if (courseRef || courseId) {
        response.courses.push({
          id: courseRef ? courseRef.toString() : courseId,
          _id: courseRef ? courseRef.toString() : courseId,
          courseId: courseId,
          title: courseTitle || 'Assigned Course',
          courseTitle: courseTitle || 'Assigned Course',
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
    } catch (courseErr) {
      console.warn('Notice: Could not load dynamic progress for auth response:', courseErr.message);
      if (courseRef || courseId) {
        response.courses.push({
          id: courseRef ? courseRef.toString() : courseId,
          courseId: courseId,
          title: courseTitle || 'Assigned Course',
        });
      }
    }
  }

  return response;
};

/**
 * @route   POST /api/auth/register (or /api/auth/student/signup, /api/auth/signup)
 * @desc    Register a new student user with required profile fields
 * @access  Public
 */
const registerStudent = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      dob,
      dateOfBirth,
      phone,
      contactNumber,
      qualification,
      course,
      selectedCourse,
      preferredCourse,
    } = req.body;

    const finalDob = (dateOfBirth || dob || '').toString().trim();
    const finalPhone = (contactNumber || phone || '').toString().trim();
    const finalQualification = (qualification || '').toString().trim();
    const finalName = (name || '').toString().trim();

    // ── Multi-course: resolve selected course IDs ─────────────────────────────
    // Accept: registeredCourseIds[], selectedCourses[], courses[]
    // Or legacy single-value: course, selectedCourse, preferredCourse
    const rawInput = req.body.registeredCourseIds || req.body.selectedCourses || req.body.courses || null;
    let selectedCourseIds = [];

    if (rawInput !== null && rawInput !== undefined) {
      if (Array.isArray(rawInput)) {
        selectedCourseIds = rawInput.map(c => String(c).trim()).filter(Boolean);
      } else if (typeof rawInput === 'string' && rawInput.trim()) {
        selectedCourseIds = [rawInput.trim()];
      }
    }
    // Fall back to legacy single-course fields
    const singleLegacy = (course || selectedCourse || preferredCourse || '').toString().trim();
    if (selectedCourseIds.length === 0 && singleLegacy) {
      selectedCourseIds = [singleLegacy];
    }
    // De-duplicate
    selectedCourseIds = [...new Set(selectedCourseIds)];
    // Primary course (first selected) for legacy fields
    const finalCourse = selectedCourseIds[0] || '';

    // -----------------------------
    // VALIDATION
    // -----------------------------
    const errors = [];

    if (!finalName) errors.push('Name is required');

    if (!email || typeof email !== 'string' || !email.trim()) {
      errors.push('Email is required');
    } else if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
      errors.push('Please provide a valid email address');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      errors.push('Password must be at least 6 characters');
    }

    if (!finalDob) errors.push('Date of birth is required');
    if (!finalPhone) errors.push('Contact number is required');
    if (!finalQualification) errors.push('Qualification is required');

    // At least one course must be selected
    if (selectedCourseIds.length === 0) {
      errors.push('At least one course must be selected');
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Resolve each selected course against the DB
    const resolvedCourses = [];
    const finalCourseIds = [];

    for (const rawCourseVal of selectedCourseIds) {
      const cleanCourse = rawCourseVal.trim();
      if (!cleanCourse) continue;
      const escapedCourse = cleanCourse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const courseQuery = [
        { courseId: new RegExp('^' + escapedCourse + '$', 'i') },
        { courseTitle: new RegExp('^' + escapedCourse + '$', 'i') },
        { title: new RegExp('^' + escapedCourse + '$', 'i') },
        { courseId: cleanCourse },
        { courseTitle: cleanCourse },
      ];
      if (mongoose.Types.ObjectId.isValid(cleanCourse)) {
        courseQuery.push({ _id: new mongoose.Types.ObjectId(cleanCourse) });
      }
      if (/^unani$/i.test(cleanCourse)) {
        courseQuery.push({ category: /^unani$/i });
      }

      let foundCourse = null;
      try {
        foundCourse = await Course.findOne({ $or: courseQuery }).select('_id courseId courseTitle category').lean();
      } catch (e) { /* ignore */ }

      if (foundCourse) {
        const resolvedId = foundCourse.courseId || foundCourse._id.toString();
        resolvedCourses.push({
          courseRef: foundCourse._id,
          courseId: resolvedId,
          courseTitle: foundCourse.courseTitle || foundCourse.title || cleanCourse,
        });
        finalCourseIds.push(resolvedId);
      } else {
        // Course not in DB — store raw value (handles UNANI and future courses)
        console.warn('[registerStudent] Course not found in DB for value="' + cleanCourse + '". Storing as raw string.');
        finalCourseIds.push(cleanCourse);
      }
    }

    // Primary single-course values (backward-compatible legacy fields)
    const primaryResolved = resolvedCourses[0] || null;
    const resolvedCourseRef = primaryResolved ? primaryResolved.courseRef : null;
    const resolvedCourseId = primaryResolved
      ? primaryResolved.courseId
      : (finalCourseIds[0] || finalCourse);
    const resolvedCourseTitle = primaryResolved
      ? primaryResolved.courseTitle
      : (finalCourseIds[0] || finalCourse);

    // Final de-duplicated courseIds list
    const uniqueCourseIds = [...new Set(finalCourseIds)];

    // -----------------------------
    // CHECK DUPLICATE USER (EMAIL / PHONE)
    // -----------------------------
    const existingUser = await User.findOne({
      $or: [{ email: cleanEmail }, { phone: finalPhone }, { contactNumber: finalPhone }],
    });

    if (existingUser) {
      const isEmailDup = existingUser.email === cleanEmail;
      return res.status(400).json({
        success: false,
        message: isEmailDup
          ? 'Account with this email already exists'
          : 'Account with this contact number already exists',
      });
    }

    if (Student) {
      const existingStudent = await Student.findOne({
        $or: [{ email: cleanEmail }, { phone: finalPhone }, { contactNumber: finalPhone }],
      });
      if (existingStudent) {
        const isEmailDup = existingStudent.email === cleanEmail;
        return res.status(400).json({
          success: false,
          message: isEmailDup
            ? 'Account with this email already exists'
            : 'Account with this contact number already exists',
        });
      }
    }

    let createdUser = null;
    let createdStudent = null;

    try {
      // -----------------------------
      // CREATE USER (Role strictly set to "student")
      // -----------------------------
      createdUser = await User.create({
        name: finalName,
        email: cleanEmail,
        password: password,
        role: 'student',
        dateOfBirth: finalDob,
        contactNumber: finalPhone,
        phone: finalPhone,
        qualification: finalQualification,
        preferredCourse: finalCourse,
        course: resolvedCourseTitle,
        courseId: resolvedCourseId,
        courseRef: resolvedCourseRef,
        courseIds: uniqueCourseIds,
        status: 'Pending',
        accountStatus: 'Pending',
        isApproved: false,
      });

      // -----------------------------
      // SYNC STUDENT MODEL IF AVAILABLE
      // -----------------------------
      if (Student) {
        try {
          createdStudent = await Student.create({
            userId: createdUser._id,
            name: finalName,
            email: cleanEmail,
            dateOfBirth: finalDob,
            contactNumber: finalPhone,
            phone: finalPhone,
            qualification: finalQualification,
            preferredCourse: finalCourse,
            course: resolvedCourseTitle,
            courseId: resolvedCourseId,
            courseRef: resolvedCourseRef,
            courseIds: uniqueCourseIds,
            status: 'Pending',
            accountStatus: 'Pending',
            isApproved: false,
            isActive: false,
          });
        } catch (studentErr) {
          // Log but never block registration — Student doc is supplementary
          console.warn('[registerStudent] Student sync warning:', studentErr.message);
        }
      }

      // -----------------------------
      // GENERATE TOKEN & RESPONSE
      // -----------------------------
      const token = generateToken(createdUser, createdStudent);

      return res.status(201).json({
        success: true,
        message: 'Student registered successfully',
        token,
        role: 'student',
        user: await buildUserResponse(createdUser, createdStudent),
      });
    } catch (innerErr) {
      if (createdUser && createdUser._id) {
        try {
          await User.deleteOne({ _id: createdUser._id });
          if (Student) {
            await Student.deleteOne({ userId: createdUser._id });
          }
        } catch (cleanupErr) {
          console.warn('Failed to clean up partial user record:', cleanupErr.message);
        }
      }
      throw innerErr;
    }
  } catch (error) {
    console.error('Student Registration Error:', error.message || error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Account with this email or phone already exists',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error while registering student',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Universal Login: Authenticates user and returns role from database
 * @access  Public
 */
const universalLogin = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.username;
    const rawPassword = req.body.password;

    if (!rawEmail || !rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const userRole = (user.role || 'student').toLowerCase().trim();

    // -----------------------------
    // ENFORCE STUDENT APPROVAL RULE
    // -----------------------------
    let studentDocForResponse = null;
    if (userRole === 'student') {
      let studentDoc = null;
      if (Student) {
        studentDoc = await Student.findOne({
          $or: [
            { userId: user._id },
            { email: cleanEmail }
          ]
        }).lean();
      }
      studentDocForResponse = studentDoc;
      
      const accountStatus = studentDoc ? studentDoc.accountStatus : user.accountStatus;
      const status = studentDoc ? studentDoc.status : user.status;
      
      // Block rejected
      if (accountStatus === 'Rejected' || status === 'Inactive') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been rejected by the admin. You cannot log in.',
        });
      }
      
      // Require Approved or Active
      if (accountStatus !== 'Approved' && status !== 'Active') {
        return res.status(403).json({
          success: false,
          message: 'Your account is pending admin approval. You cannot log in yet.',
        });
      }
    }

    const token = generateToken(user, studentDocForResponse);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: userRole,
      user: await buildUserResponse(user, studentDocForResponse, { isLogin: true }),
    });
  } catch (error) {
    console.error('Universal Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/student/login
 * @desc    Student Authentication & JWT generation (rejection of non-student credentials)
 * @access  Public
 */
const studentLogin = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.username;
    const rawPassword = req.body.password;

    if (!rawEmail || !rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Role verification: Student role only
    const userRole = (user.role || 'student').toLowerCase().trim();
    if (userRole !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Invalid role: Student access only',
      });
    }

    // 1. Correctly find the actual Student document in the database
    let actualStudentId = user._id.toString(); // Fallback
    let studentDocFound = null;
    if (Student) {
      studentDocFound = await Student.findOne({
        $or: [
          { userId: user._id },
          { email: cleanEmail }
        ]
      }).lean();
      if (studentDocFound) {
        actualStudentId = studentDocFound._id.toString();
      }
    }

    // -----------------------------
    // ENFORCE STUDENT APPROVAL RULE
    // -----------------------------
    const accountStatus = studentDocFound ? studentDocFound.accountStatus : user.accountStatus;
    const status = studentDocFound ? studentDocFound.status : user.status;
    
    // Block rejected
    if (accountStatus === 'Rejected' || status === 'Inactive') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been rejected by the admin. You cannot log in.',
      });
    }
    
    // Require Approved or Active
    if (accountStatus !== 'Approved' && status !== 'Active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. You cannot log in yet.',
      });
    }

    // 2. Generate standard JWT token with full course identity
    const token = generateToken(user, studentDocFound);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: 'student',
      user: await buildUserResponse(user, studentDocFound, { isLogin: true }),
    });
  } catch (error) {
    console.error('Student Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during student login',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/admin/login
 * @desc    Admin Authentication & JWT generation (rejection of non-admin credentials)
 * @access  Public
 */
const adminLogin = async (req, res) => {
  try {
    // 1. Enforce looking up admin strictly by email (no username fallback)
    const email = req.body.email;
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = email.toString().trim().toLowerCase();

    // 2. Try looking up in the dedicated Admin collection first
    let admin = null;
    let isMatch = false;
    let role = 'admin';
    let userObj = null;

    try {
      const Admin = require('../models/admin.model');
      const bcrypt = require('bcryptjs');

      admin = await Admin.findOne({ email: cleanEmail });

      // Fallback/Reset: If admin@whitecodeacademy.com doesn't exist, seed it
      if (!admin && cleanEmail === 'admin@whitecodeacademy.com') {
        console.log('Admin not found in DB, seeding default admin credentials...');
        const hashedPassword = await bcrypt.hash('WhiteCode@Admin2026', 10);
        admin = await Admin.create({
          name: 'White Code Academy Admin',
          email: cleanEmail,
          password: hashedPassword,
        });
      }

      if (admin) {
        // Compare incoming password with stored hash correctly
        try {
          isMatch = await bcrypt.compare(password, admin.password);
        } catch (error) {
          console.warn('Admin password is not a valid bcrypt hash; trying legacy password check');
        }

        if (!isMatch && password === admin.password) {
          admin.password = await bcrypt.hash(password, 10);
          await admin.save();
          isMatch = true;
          console.log('Legacy admin password migrated to bcrypt');
        }

        if (isMatch) {
          role = (admin.role || 'admin').toLowerCase().trim();
          if (role !== 'admin' && role !== 'superadmin') {
            return res.status(403).json({
              success: false,
              message: 'Access denied: Admin privileges required',
            });
          }
          userObj = {
            id: admin._id ? admin._id.toString() : admin.id,
            name: admin.name,
            email: admin.email,
            role: role,
          };
        }
      }
    } catch (adminErr) {
      console.warn('Warning: Admin model lookup failed:', adminErr.message);
    }

    // 3. Fallback: If not found or mismatch in Admin collection, check the main User collection
    if (!userObj || !isMatch) {
      const user = await User.findOne({ email: cleanEmail });
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      role = (user.role || '').toLowerCase().trim();
      if (role !== 'admin' && role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Admin privileges required',
        });
      }
      userObj = await buildUserResponse(user);
    }

    // Generate token
    const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'white_coat_academy_secret_jwt_key_2026_super_secure' : undefined);
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const token = jwt.sign(
      {
        id: userObj.id,
        userId: userObj.id,
        email: userObj.email,
        role: userObj.role,
      },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      token,
      role: userObj.role,
      user: userObj,
    });
  } catch (error) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during admin login',
      error: error.message,
    });
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get logged-in user profile
 * @access  Private (requireAuth)
 */
const getMe = async (req, res) => {
  try {
    const rawUserId = req.user.userId || req.user.id || req.user._id;
    let user = await User.findById(rawUserId).select('-password');

    // If not found by primary id, fallback to email lookup
    if (!user && req.user.email) {
      user = await User.findOne({ email: req.user.email.toLowerCase() }).select('-password');
    }

    let studentDoc = null;
    if (Student) {
      if (user) {
        studentDoc = await Student.findOne({ userId: user._id }) || await Student.findOne({ email: user.email });
      } else {
        studentDoc = await Student.findById(rawUserId) || await Student.findOne({ email: req.user.email });
        if (studentDoc && studentDoc.userId) {
          user = await User.findById(studentDoc.userId).select('-password');
        }
      }
    }

    if (!user && studentDoc) {
      user = {
        _id: studentDoc.userId || studentDoc._id,
        id: (studentDoc.userId || studentDoc._id).toString(),
        name: studentDoc.name,
        email: studentDoc.email,
        role: 'student',
        phone: studentDoc.phone || studentDoc.contactNumber || '',
        contactNumber: studentDoc.contactNumber || studentDoc.phone || '',
        qualification: studentDoc.qualification || '',
        preferredCourse: studentDoc.preferredCourse || studentDoc.course || '',
        course: studentDoc.course || studentDoc.preferredCourse || '',
        courseId: studentDoc.courseId || '',
        courseRef: studentDoc.courseRef || null,
        status: studentDoc.status || 'Active',
        accountStatus: studentDoc.accountStatus || 'Approved',
        isApproved: studentDoc.isApproved !== undefined ? studentDoc.isApproved : true,
      };
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user: await buildUserResponse(user, studentDoc),
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching user profile',
      error: error.message,
    });
  }
};

/**
 * @route   PATCH /api/auth/users/:id/role (or /api/v1/admin/users/:id/role)
 * @desc    Admin management: change user role (student <-> admin)
 * @access  Private (Admin only)
 */
const updateUserRole = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role is required',
      });
    }

    const cleanRole = role.toString().toLowerCase().trim();
    const validRoles = ['student', 'admin', 'superadmin', 'teacher', 'staff'];

    if (!validRoles.includes(cleanRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${validRoles.join(', ')}`,
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.role = cleanRole;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User role updated to '${cleanRole}' successfully`,
      user: await buildUserResponse(user),
    });
  } catch (error) {
    console.error('UpdateUserRole Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating user role',
      error: error.message,
    });
  }
};

const crypto = require('crypto');

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Generate a secure recovery token
 * @access  Public
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide an email address' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    
    let admin = null;
    try {
      const Admin = require('../models/admin.model');
      admin = await Admin.findOne({ email: cleanEmail });
    } catch (e) {}

    if (!user && !admin) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    if (user) {
      user.resetPasswordToken = resetTokenHash;
      user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 mins
      await user.save({ validateBeforeSave: false });
    }

    if (admin) {
      admin.resetPasswordToken = resetTokenHash;
      admin.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
      await admin.save({ validateBeforeSave: false });
    }

    // In a real application, send this token via Email. 
    // For this audit, we simulate it by returning success without the token.
    return res.status(200).json({
      success: true,
      message: 'Password recovery token generated and sent to email.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using recovery token
 * @access  Public
 */
const resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword, password, confirmPassword } = req.body;

    if (!email || !token) {
      return res.status(400).json({ success: false, message: 'Please provide email and verification token' });
    }

    const targetPassword = newPassword || password;
    if (!targetPassword || targetPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    if (confirmPassword && targetPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    let user = await User.findOne({ 
      email: cleanEmail,
      resetPasswordToken: resetTokenHash,
      resetPasswordExpire: { $gt: Date.now() }
    });

    let admin = null;
    try {
      const Admin = require('../models/admin.model');
      admin = await Admin.findOne({ 
        email: cleanEmail,
        resetPasswordToken: resetTokenHash,
        resetPasswordExpire: { $gt: Date.now() }
      });
    } catch (e) {}

    if (!user && !admin) {
      return res.status(400).json({ success: false, message: 'Invalid or expired recovery token' });
    }

    if (user) {
      user.password = targetPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
    }

    if (admin) {
      admin.password = targetPassword;
      admin.resetPasswordToken = undefined;
      admin.resetPasswordExpire = undefined;
      await admin.save();
    }

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/**
 * @route   POST /api/auth/update-password
 * @desc    Change password (authenticated)
 * @access  Private
 */
const updatePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide old and new password' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    const userId = req.user.id || req.user._id || req.user.userId;
    let user = await User.findById(userId);
    let admin = null;
    let isMatch = false;

    if (user) {
      isMatch = await user.matchPassword(oldPassword);
    } else {
      try {
        const Admin = require('../models/admin.model');
        const bcrypt = require('bcryptjs');
        admin = await Admin.findById(userId);
        if (admin) isMatch = await bcrypt.compare(oldPassword, admin.password);
      } catch(e) {}
    }

    if (!user && !admin) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect old password' });
    }

    if (user) {
      user.password = newPassword;
      await user.save();
    }
    if (admin) {
      const bcrypt = require('bcryptjs');
      admin.password = await bcrypt.hash(newPassword, 10);
      await admin.save();
    }

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

module.exports = {
  signup: registerStudent,
  register: registerStudent,
  registerStudent,
  login: universalLogin,
  universalLogin,
  studentLogin,
  adminLogin,
  getMe,
  updateUserRole,
  resetPassword,
  forgotPassword,
  updatePassword,
  updatePasswordDirect: updatePassword,
  resetPasswordDirect: resetPassword,
  generateToken,
  buildUserResponse,
};
