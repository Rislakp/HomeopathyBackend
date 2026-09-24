const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Lazy-load optional models to avoid circular dependency issues
let Admin;
let Student;
try { Admin = require('../models/admin.model'); } catch (e) { /* optional */ }
try { Student = require('../models/Student'); } catch (e) { /* optional */ }

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

/**
 * Authentication Middleware
 * Verifies JWT token and attaches authenticated user to req.user.
 *
 * Lookup order (all checked so that admins stored only in the Admin
 * collection, and students stored only in the Student collection, are
 * not falsely rejected):
 *   1. User collection  (primary – stores role field)
 *   2. Admin collection (admins created directly, not via User)
 *   3. Student collection (students created directly, not via User)
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token || !token.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Token is empty.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.',
        error: err.message,
      });
    }

    // ── DEBUG: Print the raw decoded JWT payload ───────────────────────────
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  [verifyToken / requireAuth] DECODED JWT PAYLOAD      ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('  Route            :', req.method, req.originalUrl);
    console.log('  decoded.id       :', decoded.id);
    console.log('  decoded.userId   :', decoded.userId);
    console.log('  decoded.adminId  :', decoded.adminId);
    console.log('  decoded.studentId:', decoded.studentId);
    console.log('  decoded.role     :', decoded.role);
    console.log('  decoded.email    :', decoded.email);
    console.log('  Full payload     :', JSON.stringify(decoded));
    console.log('──────────────────────────────────────────────────────\n');

    const userId =
      decoded.userId ||
      decoded.id ||
      decoded._id ||
      decoded.adminId ||
      decoded.studentId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: User ID missing.',
      });
    }

    // ------------------------------------------------------------------
    // 1. Try the primary User collection first
    // ------------------------------------------------------------------
    let foundUser = await User.findById(userId).select('-password');
    let normalizedRole = null;

    if (foundUser) {
      normalizedRole = (foundUser.role || decoded.role || 'student')
        .toString()
        .toLowerCase()
        .trim();
    }

    // ------------------------------------------------------------------
    // 2. Fallback: Admin collection
    //    Covers admins created directly in the Admin collection who may
    //    not have a corresponding User document.
    // ------------------------------------------------------------------
    if (!foundUser && Admin) {
      const adminDoc = await Admin.findById(userId).select('-password');
      if (adminDoc) {
        foundUser = adminDoc;
        // Admins in this collection carry role field (ADMIN / SUPERADMIN)
        normalizedRole = (adminDoc.role || decoded.role || 'admin').toString().toLowerCase().trim();
      }
    }

    // ------------------------------------------------------------------
    // 3. Fallback: Student collection
    //    Covers students created directly in the Student collection.
    // ------------------------------------------------------------------
    if (!foundUser && Student) {
      const studentDoc = await Student.findById(userId).select('-password');
      if (studentDoc) {
        foundUser = studentDoc;
        normalizedRole = (decoded.role || 'student').toString().toLowerCase().trim();
      }
    }

    if (!foundUser) {
      console.warn(
        `[requireAuth] Token userId ${userId} not found in User, Admin, or Student collections.`
      );
      return res.status(401).json({
        success: false,
        message: 'User associated with this token no longer exists.',
      });
    }

    let studentDoc = null;
    if (Student) {
      if (foundUser.constructor && foundUser.constructor.modelName === 'Student') {
        studentDoc = foundUser;
      } else {
        studentDoc = await Student.findOne({
          $or: [
            { userId: foundUser._id },
            { email: foundUser.email ? foundUser.email.toLowerCase() : '' },
          ],
        });
      }
    }

    const courseRef = studentDoc?.courseRef || foundUser.courseRef || null;
    const courseId = studentDoc?.courseId || foundUser.courseId || (courseRef ? courseRef.toString() : '');
    const courseTitle = studentDoc?.course || foundUser.course || foundUser.preferredCourse || '';

    req.user = {
      id: foundUser._id.toString(),
      userId: foundUser._id.toString(),
      studentId: studentDoc ? studentDoc._id.toString() : (decoded.studentId || null),
      email: foundUser.email,
      name: foundUser.name,
      role: normalizedRole,
      courseId: courseId,
      courseRef: courseRef ? courseRef.toString() : null,
      course: courseTitle,
    };

    // ── DEBUG: Print what was resolved from the DB and what req.user looks like ──
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  [verifyToken / requireAuth] REQ.USER ATTACHED        ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('  DB collection resolved :', foundUser.constructor.modelName || 'unknown');
    console.log('  req.user.id            :', req.user.id);
    console.log('  req.user.role          :', req.user.role, '  ← must be "admin" or "superadmin" for admin routes');
    console.log('  req.user.email         :', req.user.email);
    console.log('  Full req.user          :', JSON.stringify(req.user));
    console.log('──────────────────────────────────────────────────────\n');

    next();
  } catch (error) {
    console.error('RBAC requireAuth Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: error.message,
    });
  }
};

/**
 * Role Authorization Middleware Factory
 * Allows passing one or more allowed roles (e.g. requireRole('admin', 'superadmin'))
 */
const requireRole = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles
    .flat()
    .map((r) => r.toString().toLowerCase().trim());

  return async (req, res, next) => {
    // If requireAuth hasn't already run, run it first
    if (!req.user) {
      return requireAuth(req, res, (err) => {
        // Forward any error from requireAuth to Express error handler
        if (err) return next(err);

        try {
          const userRole = (req.user?.role || '').toLowerCase().trim();
          // ── DEBUG: verifyAdmin role check (req.user populated by requireAuth)
          console.log('\n╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌');
          console.log('  [verifyAdmin] Role check (via requireAuth callback)');
          console.log('  req.user.role (resolved) :', userRole);
          console.log('  allowedRoles             :', normalizedAllowedRoles);
          console.log('  Access granted?          :', normalizedAllowedRoles.includes(userRole) || (userRole === 'superadmin' && normalizedAllowedRoles.includes('admin')));
          console.log('╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\n');
          if (
            normalizedAllowedRoles.includes(userRole) ||
            (userRole === 'superadmin' && normalizedAllowedRoles.includes('admin'))
          ) {
            return next();
          }

          return res.status(403).json({
            success: false,
            message: `Forbidden: Access denied. Required role: [${normalizedAllowedRoles.join(', ')}], current role: '${userRole}'`,
            currentRole: userRole,
            allowedRoles: normalizedAllowedRoles,
          });
        } catch (innerErr) {
          return next(innerErr);
        }
      });
    }

    const userRole = (req.user.role || '').toLowerCase().trim();
    // ── DEBUG: verifyAdmin role check (req.user was pre-populated by a prior middleware)
    console.log('\n╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌');
    console.log('  [verifyAdmin] Role check (req.user already populated)');
    console.log('  req.user.role  :', userRole);
    console.log('  allowedRoles   :', normalizedAllowedRoles);
    console.log('  Access granted?:', normalizedAllowedRoles.includes(userRole) || (userRole === 'superadmin' && normalizedAllowedRoles.includes('admin')));
    console.log('╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\n');
    if (
      normalizedAllowedRoles.includes(userRole) ||
      (userRole === 'superadmin' && normalizedAllowedRoles.includes('admin'))
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Forbidden: Access denied. Required role: [${normalizedAllowedRoles.join(', ')}], current role: '${userRole}'`,
      currentRole: userRole,
      allowedRoles: normalizedAllowedRoles,
    });
  };
};

// Shorthand helpers
const requireAdmin = requireRole('admin', 'superadmin');
const requireStudent = requireRole('student');

/**
 * Middleware factory to enforce that the authenticated student has access to a specific course (e.g. 'unani').
 * Admins and Superadmins bypass this check.
 */
const requireCourseAccess = (requiredCourseId) => {
  return async (req, res, next) => {
    const runAccessCheck = async () => {
      try {
        const userRole = (req.user?.role || '').toLowerCase().trim();
        // Admin / Superadmin bypass course enrollment check
        if (['admin', 'superadmin'].includes(userRole)) {
          return next();
        }

        const targetCourseStr = String(requiredCourseId || '').toLowerCase().trim();
        if (!targetCourseStr) return next();

        // Retrieve actual Student document from DB
        let student = null;
        if (Student) {
          const userId = req.user.studentId || req.user.userId || req.user.id;
          if (req.user.studentId && require('mongoose').Types.ObjectId.isValid(req.user.studentId)) {
            student = await Student.findById(req.user.studentId);
          }
          if (!student && userId && require('mongoose').Types.ObjectId.isValid(userId)) {
            student = await Student.findOne({ userId });
            if (!student) {
              student = await Student.findById(userId);
            }
          }
          if (!student && req.user.email) {
            student = await Student.findOne({ email: req.user.email.toLowerCase() });
          }
        }

        const enrolledIds = new Set();

        // Extract course identifiers from student document
        if (student) {
          if (Array.isArray(student.courseIds)) {
            student.courseIds.forEach(id => {
              if (id) enrolledIds.add(String(id).toLowerCase().trim());
            });
          }
          if (student.courseId) enrolledIds.add(String(student.courseId).toLowerCase().trim());
          if (student.course) enrolledIds.add(String(student.course).toLowerCase().trim());
          if (student.courseRef) enrolledIds.add(String(student.courseRef).toLowerCase().trim());
          if (Array.isArray(student.enrolledCourses)) {
            student.enrolledCourses.forEach(id => {
              if (id) enrolledIds.add(String(id).toLowerCase().trim());
            });
          }

          // Check if courseRef points to a Course document with matching courseId
          if (student.courseRef && require('mongoose').Types.ObjectId.isValid(student.courseRef)) {
            try {
              const Course = require('../models/Course');
              const courseDoc = await Course.findById(student.courseRef);
              if (courseDoc) {
                if (courseDoc.courseId) enrolledIds.add(String(courseDoc.courseId).toLowerCase().trim());
                if (courseDoc.courseTitle) enrolledIds.add(String(courseDoc.courseTitle).toLowerCase().trim());
              }
            } catch (e) {
              // Ignore lookup errors
            }
          }
        }

        // Extract course identifiers from req.user
        if (req.user) {
          if (Array.isArray(req.user.courseIds)) {
            req.user.courseIds.forEach(id => {
              if (id) enrolledIds.add(String(id).toLowerCase().trim());
            });
          }
          if (req.user.courseId) enrolledIds.add(String(req.user.courseId).toLowerCase().trim());
          if (req.user.course) enrolledIds.add(String(req.user.course).toLowerCase().trim());
          if (req.user.courseRef) enrolledIds.add(String(req.user.courseRef).toLowerCase().trim());
        }

        if (enrolledIds.has(targetCourseStr)) {
          return next();
        }

        return res.status(403).json({
          success: false,
          message: `Forbidden: Access denied. Student is not enrolled in course '${requiredCourseId}'.`,
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: 'Error verifying course authorization.',
          error: err.message,
        });
      }
    };

    if (!req.user) {
      return requireAuth(req, res, (err) => {
        if (err) return next(err);
        return runAccessCheck();
      });
    }

    return runAccessCheck();
  };
};

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireStudent,
  requireCourseAccess,
  getJwtSecret,
};

