const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin = require('../models/admin.model');
let User;
try { User = require('../models/User'); } catch (e) { /* optional */ }

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

/**
 * Check if the incoming request is for a public route that does NOT require JWT authentication.
 */
const isPublicRoute = (req) => {
  const path = (req.path || '').toLowerCase();
  const originalUrl = (req.originalUrl || req.url || '').toLowerCase();

  const publicSuffixes = [
    '/login',
    '/admin/login',
    '/auth/login',
    '/register',
    '/auth/register',
    '/reset-password',
    '/update-password',
    '/forgot-password',
    '/health',
  ];

  return publicSuffixes.some(
    (suffix) => path.endsWith(suffix) || originalUrl.includes(suffix)
  );
};

/**
 * Admin Authentication Middleware
 * Protects Admin Dashboard endpoints by verifying the Admin's JWT.
 * Gracefully allows public routes (e.g. admin login) without token validation.
 */
const adminAuthMiddleware = async (req, res, next) => {
  try {
    // 1. Skip authentication on public routes (e.g. /api/admin/login, /reset-password)
    if (isPublicRoute(req)) {
      return next();
    }

    const authHeader = req.headers.authorization;

    // 2. Validate Authorization header presence and format (case-insensitive Bearer)
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    if (!/^bearer\s+/i.test(authHeader.trim())) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    const token = authHeader.trim().replace(/^bearer\s+/i, '').trim();
    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    // 3. Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        message: isExpired
          ? 'Session expired. Please log in again.'
          : 'Invalid or expired authentication token.',
      });
    }

    const adminId = decoded.adminId || decoded.userId || decoded.id || decoded._id;

    if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token: Admin ID missing or invalid.',
      });
    }

    // 4. Lookup Admin in the database (Admin collection first, fallback to User collection)
    let admin = null;
    if (Admin) {
      try {
        admin = await Admin.findById(adminId);
      } catch (dbErr) {
        console.warn('[adminAuthMiddleware] Admin collection query error:', dbErr.message);
      }
    }
    if (!admin && User) {
      try {
        const userDoc = await User.findById(adminId);
        if (userDoc) {
          const userRole = (userDoc.role || '').toUpperCase().trim();
          if (userRole === 'ADMIN' || userRole === 'SUPERADMIN') {
            admin = userDoc;
          } else {
            return res.status(403).json({
              success: false,
              message: 'Forbidden: Admin access only.',
            });
          }
        }
      } catch (dbErr) {
        console.warn('[adminAuthMiddleware] User collection query error:', dbErr.message);
      }
    }

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found.',
      });
    }

    // 5. Check if account is active
    if (admin.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Admin account is inactive.',
      });
    }

    // 6. Verify admin role (must be ADMIN or SUPERADMIN)
    const role = (admin.role || '').toUpperCase().trim();
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Admin access only.',
      });
    }

    // 7. Attach admin identity to request object
    req.admin = {
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };
    req.user = {
      id: admin._id.toString(),
      userId: admin._id.toString(),
      email: admin.email,
      role: role.toLowerCase(),
    };

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
};

module.exports = adminAuthMiddleware;
