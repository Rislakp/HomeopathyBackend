const jwt = require('jsonwebtoken');
const User = require('../models/User');

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Generate JWT token helper
 */
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  const userIdStr = user._id.toString();

  return jwt.sign(
    {
      userId: userIdStr,
      id: userIdStr,
      studentId: userIdStr,
      email: user.email,
      role: user.role || 'student',
    },
    secret,
    { expiresIn }
  );
};

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user (Student or Admin)
 * @access  Public
 */
const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // 1. Basic presence validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required',
      });
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters',
      });
    }

    if (!role || typeof role !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Role is required (student or admin)',
      });
    }

    const normalizedRole = role.trim().toLowerCase();
    if (!['student', 'admin'].includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either student or admin',
      });
    }

    // 2. Admin Signup Security Check
    if (normalizedRole === 'admin' && process.env.ALLOW_ADMIN_SIGNUP === 'false') {
      return res.status(403).json({
        success: false,
        message: 'Admin registration is restricted',
      });
    }

    // 3. Duplicate email check
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Account already exists',
      });
    }

    // 4. Create and save new user
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: normalizedRole,
    });

    const token = generateToken(user);
    const userIdStr = user._id.toString();

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      token: token,
      studentId: userIdStr,
      role: user.role,
      user: {
        id: userIdStr,
        studentId: userIdStr,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during registration',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & return token + user info
 * @access  Public
 */
const login = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.username || req.body.Email;
    const { password, role } = req.body;

    // 1. Missing fields validation
    if (!rawEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const cleanPassword = password.toString();

    // 2. Find user in database
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 3. Verify password
    const isMatch = await user.matchPassword(cleanPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 4. Role check: If client explicitly supplied role, enforce match
    if (role) {
      const requestedRole = role.toString().trim().toLowerCase();
      const dbRole = (user.role || 'student').toString().trim().toLowerCase();

      if (dbRole !== requestedRole) {
        return res.status(403).json({
          success: false,
          message: 'Invalid role',
        });
      }
    }

    // 5. Generate JWT Token
    const token = generateToken(user);
    const userIdStr = user._id.toString();
    const userRole = user.role || 'student';

    // 6. Return response formatted with studentId at root and inside user object
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token: token,
      studentId: userIdStr,
      role: userRole,
      user: {
        id: userIdStr,
        studentId: userIdStr,
        name: user.name,
        email: user.email,
        role: userRole,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: error.message,
    });
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get currently authenticated user info
 * @access  Private (Requires valid JWT)
 */
const getMe = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User session not found',
      });
    }

    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const userIdStr = user._id.toString();
    const userRole = user.role || 'student';

    return res.status(200).json({
      success: true,
      studentId: userIdStr,
      role: userRole,
      user: {
        id: userIdStr,
        studentId: userIdStr,
        name: user.name,
        email: user.email,
        role: userRole,
      },
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving user profile',
    });
  }
};

module.exports = {
  register,
  login,
  getMe,
};
