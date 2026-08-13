const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token is missing.',
      });
    }

    const secret =
      process.env.JWT_SECRET ||
      'white_coat_academy_secret_jwt_key_2026_super_secure';

    let decoded;

    try {
      decoded = jwt.verify(token, secret);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
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
        message: 'Invalid token: user ID missing.',
      });
    }

    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    // No role handling
    req.user = {
      id: user._id.toString(),
      userId: user._id.toString(),
      studentId: user._id.toString(),
      email: user.email,
      name: user.name,
    };

    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal authentication error.',
    });
  }
};

module.exports = authMiddleware;