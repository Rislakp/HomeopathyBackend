const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware
 * Extracts user/student ID from Bearer token, custom header, or query param.
 * Falls back safely for development if testing without full JWT.
 */
function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');
        req.user = { id: decoded.id || decoded._id || decoded.studentId };
        return next();
      } catch (jwtErr) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired authentication token.'
        });
      }
    }

    // Support explicit student-id header for development/testing if token not provided
    const directUserId = req.headers['x-student-id'] || req.headers['x-user-id'];
    if (directUserId) {
      req.user = { id: directUserId };
      return next();
    }

    // If req.user is already set by upstream middleware
    if (req.user && req.user.id) {
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please provide a Bearer token or Authorization header.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
      error: error.message
    });
  }
}

module.exports = authenticateUser;
