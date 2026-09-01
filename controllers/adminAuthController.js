const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/admin.model');

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    'white_coat_academy_secret_jwt_key_2026_super_secure'
  );
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/auth/login
 * Process:
 * 1. Validate email structure/presence.
 * 2. Validate password presence.
 * 3. Find admin by email.
 * 4. Check isActive.
 * 5. Compare password using comparePassword.
 * 6. Generate JWT.
 * 7. Return admin details and JWT token.
 */
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validate request fields
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Validate email format
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 3. Find admin by email
    const admin = await Admin.findOne({ email: cleanEmail });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 4. Check isActive
    if (admin.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Admin account is inactive',
      });
    }

    // 5. Compare password using comparePassword instance method
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 6. Generate JWT payload: userId, id, adminId, email, role
    const adminRole = (admin.role || 'ADMIN').toString().trim();
    const token = jwt.sign(
      {
        userId: admin._id.toString(),
        id: admin._id.toString(),
        adminId: admin._id.toString(),
        email: admin.email,
        role: adminRole.toLowerCase() === 'superadmin' ? 'superadmin' : 'admin',
      },
      getJwtSecret(),
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '30d',
      }
    );

    // 7. Return admin details (excluding password) and JWT token
    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: {
        admin: {
          _id: admin._id.toString(),
          id: admin._id.toString(),
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
        user: {
          _id: admin._id.toString(),
          id: admin._id.toString(),
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
        token,
      },
      token,
      user: {
        _id: admin._id.toString(),
        id: admin._id.toString(),
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: error.message,
    });
  }
};

/**
 * Safe Admin Seeding Mechanism
 * Seeds the initial admin account in MongoDB only if it does not already exist.
 */
const seedInitialAdmin = async () => {
  try {
    const adminEmail = 'admin@whitecodeacademy.com';
    const existingAdmin = await Admin.findOne({ email: adminEmail });

    if (!existingAdmin) {
      console.log('🌱 Seeding initial Admin account...');
      await Admin.create({
        name: 'White Code Academy Admin',
        email: adminEmail,
        password: 'WhiteCode@Admin2026', // Hashed in pre-save hook
        role: 'ADMIN',
        isActive: true,
      });
      console.log('✅ Initial Admin account seeded successfully.');
    } else {
      console.log('ℹ️ Admin account already exists. Skipping seeding.');
    }
  } catch (error) {
    console.error('❌ Failed to seed initial Admin account:', error.message);
  }
};

const registerAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required',
      });
    }

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      return res.status(400).json({
        message: 'Admin already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await Admin.create({
      name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      message: 'Admin registered successfully',
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error('Register error:', error);

    res.status(500).json({
      message: 'Registration failed',
      error: error.message,
    });
  }
};

module.exports = {
  adminLogin,
  seedInitialAdmin,
  registerAdmin,
};

