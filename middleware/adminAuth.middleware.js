const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin = require('../models/admin.model');

const getJwtSecret = () => {
  return process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
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
 * Protects admin-only routes by validating JWT authorization tokens.
 * Skips public routes (e.g. login).
 */
const adminAuth = async (req, res, next) => {
  try {
    // 1. Skip authentication on public routes (e.g. /api/admin/login)
    if (isPublicRoute(req)) {
      return next();
    }

    const authHeader = req.headers.authorization;

    // 2. Missing or malformed Authorization header (case-insensitive Bearer check)
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
        code: 'AUTH_HEADER_MISSING',
      });
    }

    if (!/^bearer\s+/i.test(authHeader.trim())) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
        code: 'AUTH_HEADER_MALFORMED',
      });
    }

    const token = authHeader.trim().replace(/^bearer\s+/i, '').trim();

    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Token is empty.',
        code: 'TOKEN_EMPTY',
      });
    }

    let decoded;
    
    // 3. Verify JWT safely
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please log in again.',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
        code: 'TOKEN_INVALID',
      });
    }

    // Extract ID from various possible payload structures
    const adminId = decoded.adminId || decoded.userId || decoded.id || decoded._id;

    if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
        code: 'TOKEN_PAYLOAD_INVALID',
      });
    }

    // 4. Verify admin exists in the database
    let admin = null;
    try {
      admin = await Admin.findById(adminId).select('-password');
    } catch (dbErr) {
      console.warn('[adminAuth.middleware] Error querying Admin:', dbErr.message);
    }
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found.',
        code: 'ADMIN_NOT_FOUND',
      });
    }

    // 5. Attach decoded admin to req.user (and req.admin for backwards compatibility)
    req.user = {
      _id: admin._id.toString(),
      id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      role: admin.role || decoded.role || 'admin',
    };
    req.admin = req.user;

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication.',
    });
  }
};

module.exports = { adminAuth };

