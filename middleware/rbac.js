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
      console.log('\n--- DECODED JWT PAYLOAD ---');
      console.log(decoded);
      console.log('---------------------------\n');
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.',
        error: err.message,
      });
    }

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

    req.user = {
      id: foundUser._id.toString(),
      userId: foundUser._id.toString(),
      email: foundUser.email,
      name: foundUser.name,
      role: normalizedRole,
    };

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

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireStudent,
  getJwtSecret,
};
