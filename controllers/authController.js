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
 * Generate JWT token containing user id, email, and role from database
 */
const generateToken = (user) => {
  const secret =
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure';
  const role = (user.role || 'student').toLowerCase().trim();
  return jwt.sign(
    {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: role,
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    }
  );
};

/**
 * Helper to build sanitized user JSON response object
 */
const buildUserResponse = (user) => {
  return {
    id: user._id ? user._id.toString() : user.id,
    name: user.name,
    email: user.email,
    role: (user.role || 'student').toLowerCase().trim(),
    phone: user.phone || user.contactNumber || '',
    contactNumber: user.contactNumber || user.phone || '',
    qualification: user.qualification || '',
    dateOfBirth: user.dateOfBirth || '',
  };
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
      errors.push('Password must be at least 6 characters');
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
    // CREATE USER (Role strictly set to "student")
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
      user: buildUserResponse(user),
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
 * @route   POST /api/auth/login
 * @desc    Universal Login: Authenticates user and returns role from database
 * @access  Public
 */
const universalLogin = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.username;
    const rawPassword = req.body.password;

    if (!rawEmail || !rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const userRole = (user.role || 'student').toLowerCase().trim();
    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: userRole,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error('Universal Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/student/login
 * @desc    Student Authentication & JWT generation (rejection of non-student credentials)
 * @access  Public
 */
const studentLogin = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.username;
    const rawPassword = req.body.password;

    if (!rawEmail || !rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Role verification: Student role only
    const userRole = (user.role || 'student').toLowerCase().trim();
    if (userRole !== 'student') {
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
      user: buildUserResponse(user),
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
    const rawEmail = req.body.email || req.body.username;
    const rawPassword = req.body.password;

    if (!rawEmail || !rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = rawEmail.toString().trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Role verification: Admin privileges required
    const userRole = (user.role || '').toLowerCase().trim();
    if (userRole !== 'admin' && userRole !== 'superadmin') {
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
      role: userRole,
      user: buildUserResponse(user),
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
 * @access  Private (requireAuth)
 */
const getMe = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user: buildUserResponse(user),
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

/**
 * @route   PATCH /api/auth/users/:id/role (or /api/v1/admin/users/:id/role)
 * @desc    Admin management: change user role (student <-> admin)
 * @access  Private (Admin only)
 */
const updateUserRole = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role is required',
      });
    }

    const cleanRole = role.toString().toLowerCase().trim();
    const validRoles = ['student', 'admin', 'superadmin', 'teacher', 'staff'];

    if (!validRoles.includes(cleanRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${validRoles.join(', ')}`,
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.role = cleanRole;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User role updated to '${cleanRole}' successfully`,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error('UpdateUserRole Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating user role',
      error: error.message,
    });
  }
};

/**
 * @route   POST /api/auth/reset-password
 * @route   PUT  /api/auth/reset-password
 * @route   POST /api/auth/update-password
 * @route   PUT  /api/auth/update-password
 * @desc    Direct password reset/update without OTP verification
 * @access  Public
 */
const resetPassword = async (req, res) => {
  try {
    const {
      email,
      newPassword,
      password,
      confirmPassword,
      confirmNewPassword,
    } = req.body;

    // 1. Email validation
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    // 2. New Password validation
    const targetPassword = newPassword || password;
    if (
      !targetPassword ||
      typeof targetPassword !== 'string' ||
      !targetPassword.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a new password',
      });
    }

    if (targetPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    // 3. Confirm Password check (if provided)
    const targetConfirmPassword =
      confirmPassword !== undefined ? confirmPassword : confirmNewPassword;
    if (
      targetConfirmPassword !== undefined &&
      targetConfirmPassword !== null &&
      targetConfirmPassword !== '' &&
      targetPassword !== targetConfirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match',
      });
    }

    // 4. Check user existence in DB
    const user = await User.findOne({ email: cleanEmail });
    let admin = null;

    try {
      const Admin = require('../models/admin.model');
      admin = await Admin.findOne({ email: cleanEmail });
    } catch (e) {
      // Admin model lookup is supplementary
    }

    if (!user && !admin) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email',
      });
    }

    // 5. Update and securely save (pre-save hook hashes with bcrypt automatically)
    if (user) {
      user.password = targetPassword;
      await user.save();
    }

    if (admin) {
      admin.password = targetPassword;
      await admin.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Reset/Update Password Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating password',
      error: error.message,
    });
  }
};

module.exports = {
  signup: registerStudent,
  register: registerStudent,
  registerStudent,
  login: universalLogin,
  universalLogin,
  studentLogin,
  adminLogin,
  getMe,
  updateUserRole,
  resetPassword,
  updatePassword: resetPassword,
  resetPasswordDirect: resetPassword,
  generateToken,
};