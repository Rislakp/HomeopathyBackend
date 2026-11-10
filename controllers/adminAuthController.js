const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Admin = require('../models/admin.model');
const { sendPasswordResetEmail } = require('../services/emailService');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'white_coat_academy_secret_jwt_key_2026_super_secure' : undefined);
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
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

    // Check DB Connection State
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      console.error('Database is not connected. readyState:', mongoose.connection.readyState);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during login: Database not connected',
      });
    }

    // 3. Find admin by email
    const admin = await Admin.findOne({ email: cleanEmail }).lean();

    if (!admin) {
      console.warn('[adminLogin] Login failed: incorrect email');
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

    // 5. Compare password using bcrypt, then migrate legacy plain-text passwords.
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, admin.password);
    } catch (error) {
      console.warn('[adminLogin] Stored password is not a valid bcrypt hash; trying legacy password check');
    }

    if (!isMatch && password === admin.password) {
      isMatch = true;
      admin.password = await bcrypt.hash(password, 10);
      await Admin.updateOne({ _id: admin._id }, { $set: { password: admin.password, role: admin.role || 'ADMIN', isActive: true } });
      console.log('[adminLogin] Legacy plain-text password migrated to bcrypt');
    }

    if (!isMatch) {
      console.warn('[adminLogin] Login failed: incorrect password');
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!admin.role || !['ADMIN', 'SUPERADMIN'].includes(admin.role.toString().trim().toUpperCase())) {
      console.warn('[adminLogin] Login rejected: Admin record has an invalid role');
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required',
      });
    }

    if (!admin.role || !admin.isActive) {
      admin.role = admin.role || 'ADMIN';
      admin.isActive = true;
      await admin.save();
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
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      }
    );

    const refreshSecret = process.env.JWT_REFRESH_SECRET || (getJwtSecret() + '_refresh');
    const refreshToken = jwt.sign(
      {
        userId: admin._id.toString(),
        id: admin._id.toString(),
        adminId: admin._id.toString(),
        role: adminRole.toLowerCase() === 'superadmin' ? 'superadmin' : 'admin',
        tokenVersion: admin.tokenVersion || 0,
        type: 'refresh',
      },
      refreshSecret,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
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
          role: adminRole,
        },
        user: {
          _id: admin._id.toString(),
          id: admin._id.toString(),
          name: admin.name,
          email: admin.email,
          role: adminRole,
        },
        token,
        accessToken: token,
        refreshToken,
      },
      token,
      accessToken: token,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      user: {
        _id: admin._id.toString(),
        id: admin._id.toString(),
        name: admin.name,
        email: admin.email,
        role: adminRole,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: error.message,
    });
  }
};

/**
 * Force the default admin into a known, secure state during startup.
 */
const seedInitialAdmin = async () => {
  const adminEmail = 'admin@whitecodeacademy.com';
  const hashedPassword = await bcrypt.hash('WhiteCode@Admin2026', 10);

  const admin = await Admin.findOneAndUpdate(
    { email: adminEmail },
    {
      $set: {
        name: 'White Code Academy Admin',
        password: hashedPassword,
        role: 'ADMIN',
        isActive: true,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`✅ Default admin ready: ${admin.email}`);
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

/**
 * POST /api/admin/auth/forgot-password
 *
 * Workflow:
 * 1. Validates presence and format of admin email address.
 * 2. Checks if demo admin account is restricted via configuration.
 * 3. Looks up registered Admin. Returns generic success if not found (prevents enumeration).
 * 4. Generates a cryptographically secure 32-byte hex token.
 * 5. Stores only the SHA-256 hashed token with 15-minute expiration in Admin record.
 * 6. Dispatches password reset email with secure one-time link.
 * 7. Returns a generic success response.
 */
const adminForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

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

    const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || 'admin@whitecodeacademy.com').trim().toLowerCase();
    const isDemoRestricted = process.env.RESTRICT_DEMO_ADMIN_PASSWORD_RESET !== 'false';

    // Demo account protection: if restricted, log and return generic success to avoid enumeration
    if (cleanEmail === demoAdminEmail && isDemoRestricted) {
      console.warn(`[adminForgotPassword] Password reset blocked for demo admin account (${cleanEmail}) by RESTRICT_DEMO_ADMIN_PASSWORD_RESET.`);
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, password reset instructions have been sent.',
      });
    }

    const admin = await Admin.findOne({ email: cleanEmail });

    // Prevent email enumeration: return generic success even if account does not exist or is inactive
    if (!admin || admin.isActive === false) {
      console.log(`[adminForgotPassword] Account lookup returned no active admin for: ${cleanEmail}`);
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, password reset instructions have been sent.',
      });
    }

    // Generate single-use cryptographically secure reset token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiryMinutes = parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES, 10) || 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    admin.resetPasswordToken = hashedToken;
    admin.resetPasswordExpire = expiresAt;
    await admin.save({ validateBeforeSave: false });

    const portalBaseUrl = process.env.ADMIN_PORTAL_URL || 'https://admin.whitecoat.academy';
    const resetUrl = `${portalBaseUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(cleanEmail)}`;

    try {
      await sendPasswordResetEmail({
        to: cleanEmail,
        name: admin.name || 'Admin',
        resetToken: rawToken,
        resetUrl,
        expiresInMinutes: expiryMinutes,
      });
    } catch (emailError) {
      console.error('[adminForgotPassword] Failed to dispatch reset email:', emailError.message);
      admin.resetPasswordToken = undefined;
      admin.resetPasswordExpire = undefined;
      await admin.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Failed to send password reset email. Please try again later.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, password reset instructions have been sent.',
    });
  } catch (error) {
    console.error('[adminForgotPassword] Server error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing password reset request',
    });
  }
};

/**
 * POST /api/admin/auth/reset-password
 *
 * Workflow:
 * 1. Validates email, reset token, new password, and password confirmation.
 * 2. Checks if demo admin account is restricted.
 * 3. Hashes the incoming raw token and locates matching Admin record.
 * 4. Verifies token expiration.
 * 5. Hashes the new password using bcrypt (cost factor 10).
 * 6. Invalidates the token (single-use) and increments tokenVersion to revoke active sessions.
 * 7. Saves updated Admin record and returns success.
 */
const adminResetPassword = async (req, res) => {
  try {
    const { email, token, newPassword, password, confirmPassword } = req.body;
    const targetPassword = newPassword || password;

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

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid password reset token',
      });
    }

    if (!targetPassword || typeof targetPassword !== 'string' || !targetPassword.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a new password',
      });
    }

    if (targetPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
      });
    }

    if (confirmPassword && targetPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || 'admin@whitecodeacademy.com').trim().toLowerCase();
    const isDemoRestricted = process.env.RESTRICT_DEMO_ADMIN_PASSWORD_RESET !== 'false';

    if (cleanEmail === demoAdminEmail && isDemoRestricted) {
      return res.status(403).json({
        success: false,
        message: 'Password recovery flow is disabled for the demo admin account.',
      });
    }

    const cleanToken = token.trim();
    const hashedToken = crypto.createHash('sha256').update(cleanToken).digest('hex');

    const admin = await Admin.findOne({
      email: cleanEmail,
      resetPasswordToken: hashedToken,
    });

    if (!admin) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token',
      });
    }

    // Verify token expiration
    if (!admin.resetPasswordExpire || admin.resetPasswordExpire.getTime() < Date.now()) {
      admin.resetPasswordToken = undefined;
      admin.resetPasswordExpire = undefined;
      await admin.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        message: 'Password reset token has expired. Please request a new one.',
      });
    }

    // Hash the new password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(targetPassword, salt);

    // Invalidate token (single-use) and increment tokenVersion to revoke active sessions
    admin.password = hashedPassword;
    admin.resetPasswordToken = undefined;
    admin.resetPasswordExpire = undefined;
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();

    console.log(`[adminResetPassword] Password reset successfully for admin: ${admin.email}`);

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('[adminResetPassword] Server error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while resetting password',
    });
  }
};

module.exports = {
  adminLogin,
  seedInitialAdmin,
  registerAdmin,
  adminForgotPassword,
  adminResetPassword,
};

