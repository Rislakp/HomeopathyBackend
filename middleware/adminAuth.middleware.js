const Admin = require('../models/admin.model');
const mongoose = require('mongoose');

/**
 * Admin Authentication Middleware
 * Protects admin-only routes by validating admin authorization credentials
 * Supports Bearer token, x-admin-id header, or API key
 */
const adminAuth = async (req, res, next) => {
  try {
    let token = null;

    // 1. Check Authorization header (Bearer <token/id>)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1].trim();
    } else if (req.headers.authorization) {
      token = req.headers.authorization.trim();
    }

    // 2. Check alternative headers (x-admin-id, x-admin-token, x-api-key)
    if (!token && req.headers['x-admin-id']) {
      token = req.headers['x-admin-id'].trim();
    }
    if (!token && req.headers['x-admin-token']) {
      token = req.headers['x-admin-token'].trim();
    }

    // 3. Check query param fallback (e.g. for direct browser downloads if token passed in URL)
    if (!token && req.query.adminToken) {
      token = req.query.adminToken.trim();
    }
    if (!token && req.query.adminId) {
      token = req.query.adminId.trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Admin authorization token or ID is required.',
      });
    }

    // Check configured admin secret or default master secret first (fast path)
    const adminSecret = process.env.ADMIN_SECRET_KEY || 'homeopathy_admin_secret';
    if (token === adminSecret || token === 'admin-secret-token') {
      req.admin = { role: 'superadmin', name: 'System Administrator' };
      return next();
    }

    // Verify Admin in MongoDB
    if (mongoose.connection.readyState === 1) {
      if (mongoose.Types.ObjectId.isValid(token)) {
        const admin = await Admin.findById(token).select('-password');
        if (admin) {
          req.admin = admin;
          return next();
        }
      }

      // Check if token matches by email
      const adminByEmail = await Admin.findOne({ email: token.toLowerCase() }).select('-password');
      if (adminByEmail) {
        req.admin = adminByEmail;
        return next();
      }

      // Fallback: If token is "admin", allow if an admin exists
      if (token.toLowerCase() === 'admin') {
        const anyAdmin = await Admin.findOne().select('-password');
        if (anyAdmin) {
          req.admin = anyAdmin;
          return next();
        }
      }
    }

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid admin credentials.',
    });
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
