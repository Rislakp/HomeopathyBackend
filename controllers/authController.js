const jwt = require('jsonwebtoken');
const User = require('../models/User');
let Student;
try {
  Student = require('../models/Student');
} catch (e) {
  // Student model optional
}

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Generate JWT token containing user id, email, and role
 */
const generateToken = (user) => {
  const secret =
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure';
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role || 'student',
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    }
  );
};

/**
 * @route   POST /api/auth/register (or /api/auth/student/signup, /api/auth/signup)
 * @desc    Register a new student user with required profile fields
 * @access  Public
 */
const registerStudent = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      dob,
      dateOfBirth,
      phone,
      contactNumber,
      qualification,
    } = req.body;

    const finalDob = (dateOfBirth || dob || '').toString().trim();
    const finalPhone = (contactNumber || phone || '').toString().trim();
    const finalQualification = (qualification || '').toString().trim();
    const finalName = (name || '').toString().trim();

    // -----------------------------
    // VALIDATION
    // -----------------------------
    const errors = [];

    if (!finalName) {
      errors.push('Name is required');
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      errors.push('Email is required');
    } else if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
      errors.push('Please provide a valid email address');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      errors.push('Password is required and must be at least 6 characters');
    }

    if (!finalDob) {
      errors.push('Date of birth is required');
    }

    if (!finalPhone) {
      errors.push('Contact number is required');
    }

    if (!finalQualification) {
      errors.push('Qualification is required');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // -----------------------------
    // CHECK DUPLICATE USER (EMAIL / PHONE)
    // -----------------------------
    const existingUser = await User.findOne({
      $or: [
        { email: cleanEmail },
        { phone: finalPhone },
        { contactNumber: finalPhone },
      ],
    });

    if (existingUser) {
      const isEmailDup = existingUser.email === cleanEmail;
      return res.status(400).json({
        success: false,
        message: isEmailDup
          ? 'Account with this email already exists'
          : 'Account with this contact number already exists',
      });
    }

    // -----------------------------
    // CREATE USER (Role defaults to "student")
    // -----------------------------
    const user = await User.create({
      name: finalName,
      email: cleanEmail,
      password: password,
      role: 'student',
      dateOfBirth: finalDob,
      contactNumber: finalPhone,
      phone: finalPhone,
      qualification: finalQualification,
    });

    // -----------------------------
    // SYNC STUDENT MODEL IF AVAILABLE
    // -----------------------------
    if (Student) {
      try {
        await Student.create({
          name: finalName,
          email: cleanEmail,
          dateOfBirth: finalDob,
          contactNumber: finalPhone,
          phone: finalPhone,
          qualification: finalQualification,
          userId: user._id,
        });
      } catch (studentErr) {
        console.warn('Student sync warning:', studentErr.message);
      }
    }

    // -----------------------------
    // GENERATE TOKEN & RESPONSE
    // -----------------------------
    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      token,
      role: 'student',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone || user.contactNumber,
        contactNumber: user.contactNumber || user.phone,
        qualification: user.qualification,
        dateOfBirth: user.dateOfBirth,
        role: 'student',
      },
    });
  } catch (error) {
    console.error('Student Registration Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Account with this email or phone already exists',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error while registering student',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/login (or /api/auth/student/login)
 * @desc    Student Authentication & JWT generation (rejection of non-student credentials)
 * @access  Public
 */
const studentLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // -----------------------------
    // ROLE CHECK: Student access only
    // -----------------------------
    if (user.role && user.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Invalid role: Student access only',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: 'student',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone || user.contactNumber || '',
        qualification: user.qualification || '',
        dateOfBirth: user.dateOfBirth || '',
        role: 'student',
      },
    });
  } catch (error) {
    console.error('Student Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during student login',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/admin/login
 * @desc    Admin Authentication & JWT generation (rejection of non-admin credentials)
 * @access  Public
 */
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // -----------------------------
    // ROLE CHECK: Admin privileges required
    // -----------------------------
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin privileges required',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      token,
      role: user.role,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during admin login',
      error: error.message,
    });
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get logged-in user profile
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id || req.user.userId;
    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role || 'student',
        phone: user.phone || user.contactNumber || '',
        qualification: user.qualification || '',
        dateOfBirth: user.dateOfBirth || '',
      },
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching user profile',
      error: error.message,
    });
  }
};

module.exports = {
  signup: registerStudent,
  register: registerStudent,
  registerStudent,
  login: studentLogin,
  studentLogin,
  adminLogin,
  getMe,
};