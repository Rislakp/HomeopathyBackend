const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Admin Authentication & Authorization Middleware
 * Verifies JWT Bearer token and enforces admin/super_admin role permissions.
 */
const requireAdminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Bearer token missing.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Token is empty.',
      });
    }

    const secret =
      process.env.JWT_SECRET ||
      'white_coat_academy_secret_jwt_key_2026_super_secure';

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
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
      decoded._id;

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

    const userRole = (user.role || decoded.role || '').toLowerCase().replace(/[-_]/g, '');
    const allowedRoles = ['admin', 'superadmin'];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin or Super Admin privileges required.',
        userRole: user.role,
      });
    }

    req.user = {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authorization.',
      error: error.message,
    });
  }
};

module.exports = requireAdminAuth;
