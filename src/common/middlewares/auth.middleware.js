const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

/**
 * Authentication Middleware
 * Extracts user/student ID from Bearer token or custom header,
 * attaches user role and id to req.user.
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (token) {
      try {
        const secret =
          process.env.JWT_SECRET ||
          'white_coat_academy_secret_jwt_key_2026_super_secure';
        const decoded = jwt.verify(token, secret);
        const userId =
          decoded.userId || decoded.id || decoded._id || decoded.adminId || decoded.studentId;

        let userRole = decoded.role;
        if (!userRole && userId) {
          const userDoc = await User.findById(userId).select('role').lean();
          userRole = userDoc ? userDoc.role : 'student';
        }

        req.user = {
          id: userId ? userId.toString() : undefined,
          userId: userId ? userId.toString() : undefined,
          email: decoded.email,
          role: (userRole || 'student').toLowerCase(),
        };
        return next();
      } catch (jwtErr) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired authentication token.',
        });
      }
    }

    // Support explicit student-id header for development/testing if token not provided
    const directUserId = req.headers['x-student-id'] || req.headers['x-user-id'];
    if (directUserId) {
      req.user = {
        id: directUserId.toString(),
        userId: directUserId.toString(),
        role: 'student',
      };
      return next();
    }

    // If req.user is already set by upstream middleware
    if (req.user && req.user.id) {
      return next();
    }

    return res.status(401).json({
      success: false,
      message:
        'Authentication required. Please provide a Bearer token or Authorization header.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
      error: error.message,
    });
  }
}

module.exports = authenticateUser;
