const express = require('express');
const router = express.Router();
const {
  adminLogin,
  registerAdmin,
  adminForgotPassword,
  adminResetPassword,
} = require('../controllers/adminAuthController');
const { refreshTokenHandler } = require('../controllers/authController');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Rate limiters to prevent brute-force attacks and abuse
const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 requests per 15 minutes per IP/email
  message: 'Too many password reset requests. Please try again after 15 minutes.',
});

const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per 15 minutes per IP
  message: 'Too many password reset attempts. Please try again after 15 minutes.',
});

// Route: POST /api/admin/auth/register
router.post('/register', registerAdmin);

// Route: POST /api/admin/auth/login
router.post('/login', adminLogin);

// Route: POST /api/admin/auth/refresh
router.post('/refresh', refreshTokenHandler);
router.post('/refresh-token', refreshTokenHandler);

// Route: Password recovery initiation for admin portal
router.post('/forgot-password', forgotPasswordLimiter, adminForgotPassword);
router.put('/forgot-password', forgotPasswordLimiter, adminForgotPassword);

// Route: Password reset completion for admin portal
router.post('/reset-password', resetPasswordLimiter, adminResetPassword);
router.put('/reset-password', resetPasswordLimiter, adminResetPassword);
router.patch('/reset-password', resetPasswordLimiter, adminResetPassword);

module.exports = router;
