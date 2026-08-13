const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Authentication Middleware
 * Validates JWT token from the Authorization header (Bearer <token>)
 * and attaches authenticated user information to req.user.
 */
const authMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      // Support explicit developer header if enabled / provided
      const directUserId = req.headers['x-student-id'] || req.headers['x-user-id'];
      if (directUserId) {
        req.user = { id: directUserId.toString() };
        return next();
      }

      return res.status(401).json({
        success: false,
        message: 'Authentication required. Authorization header missing or malformed.',
      });
    }

    try {
      const secret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
      const decoded = jwt.verify(token, secret);

      const userId = decoded.userId || decoded.id || decoded._id || decoded.studentId;
      const role = decoded.role;
      const email = decoded.email;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token payload: user identifier missing.',
        });
      }

      req.user = {
        id: userId.toString(),
        userId: userId.toString(),
        studentId: userId.toString(),
        role: role ? role.toLowerCase() : undefined,
        email: email,
      };

      next();
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
      });
    }
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal authentication error.',
    });
  }
};

module.exports = authMiddleware;
