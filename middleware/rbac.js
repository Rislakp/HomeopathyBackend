const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

/**
 * Authentication Middleware
 * Verifies JWT token and attaches authenticated user to req.user
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

    const userId =
      decoded.userId ||
      decoded.id ||
      decoded._id ||
      decoded.studentId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: User ID missing.',
      });
    }

    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User associated with this token no longer exists.',
      });
    }

    const normalizedRole = (user.role || decoded.role || 'student')
      .toString()
      .toLowerCase()
      .trim();

    req.user = {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
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
