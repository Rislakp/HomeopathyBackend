const jwt = require('jsonwebtoken');
const Admin = require('../models/admin.model');

const getJwtSecret = () => {
  return process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
};

/**
 * Admin Authentication Middleware
 * Protects admin-only routes by validating JWT authorization tokens
 */
const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // 1. Missing Authorization header
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authorization header is missing.',
        code: 'AUTH_HEADER_MISSING',
      });
    }

    // 2. Malformed Authorization header
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Malformed authorization header (must start with Bearer).',
        code: 'AUTH_HEADER_MALFORMED',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token || !token.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token is empty.',
        code: 'TOKEN_EMPTY',
      });
    }

    let decoded;
    
    // 3. Verify JWT safely and differentiate error types
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please log in again.',
          code: 'TOKEN_EXPIRED',
          error: err.message,
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
        code: 'TOKEN_INVALID',
        error: err.message,
      });
    }

    // Extract ID from various possible payload structures
    const adminId = decoded.adminId || decoded.userId || decoded.id || decoded._id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token structure: Admin ID missing.',
        code: 'TOKEN_PAYLOAD_INVALID',
      });
    }

    // 4. Verify admin exists in the database
    const admin = await Admin.findById(adminId).select('-password');
    
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
      error: error.message,
    });
  }
};

module.exports = { adminAuth };
