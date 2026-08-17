const jwt = require('jsonwebtoken');
const Admin = require('../models/admin.model');

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

/**
 * Admin Authentication Middleware
 * Protects Admin Dashboard endpoints by verifying the Admin's JWT.
 */
const adminAuthMiddleware = async (req, res, next) => {
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
        message: 'Invalid or expired token',
        error: err.message,
      });
    }

    const adminId = decoded.adminId || decoded.id || decoded.userId;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: Admin ID missing.',
      });
    }

    // Lookup Admin in the database
    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin account not found.',
      });
    }

    // Check if account is active
    if (admin.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Admin account is inactive',
      });
    }

    // Verify admin role (must be ADMIN or SUPERADMIN)
    const role = (admin.role || '').toUpperCase().trim();
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Admin access only.',
      });
    }

    // Attach admin to request object
    req.admin = {
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role,
    };

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: error.message,
    });
  }
};

module.exports = adminAuthMiddleware;
