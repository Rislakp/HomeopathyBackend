const express = require('express');
const router = express.Router();

const {
  registerStudent,
  universalLogin,
  studentLogin,
  adminLogin,
  getMe,
  updateUserRole,
  resetPassword,
  forgotPassword,
  updatePassword,
  refreshTokenHandler,
  logoutHandler,
} = require('../controllers/authController');

const { requireAuth, requireAdmin } = require('../middleware/rbac');
const { createRateLimiter } = require('../middleware/rateLimiter');

const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password reset requests. Please try again after 15 minutes.',
});

const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset attempts. Please try again after 15 minutes.',
});

// -----------------------------
// TOKEN REFRESH & SESSION MANAGEMENT
// -----------------------------
router.post('/refresh', refreshTokenHandler);
router.post('/refresh-token', refreshTokenHandler);
router.post('/student/refresh', refreshTokenHandler);
router.post('/student/refresh-token', refreshTokenHandler);
router.post('/logout', requireAuth, logoutHandler);

// -----------------------------
// STUDENT REGISTRATION ENDPOINTS
// -----------------------------
router.post('/register', registerStudent);
router.post('/student/signup', registerStudent);
router.post('/signup', registerStudent);
router.post('/register-student', registerStudent);

// -----------------------------
// LOGIN ENDPOINTS
// -----------------------------
// Universal Login: Authenticates user, returns DB role and token
router.post('/login', universalLogin);

// Dedicated Student Login (enforces student role)
router.post('/student/login', studentLogin);

// Dedicated Admin Login (enforces admin / superadmin role)
router.post('/admin/login', adminLogin);

// -----------------------------
// PASSWORD MANAGEMENT
// -----------------------------
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.put('/forgot-password', forgotPasswordLimiter, forgotPassword);

router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.put('/reset-password', resetPasswordLimiter, resetPassword);
router.patch('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/password/reset', resetPassword);
router.put('/password/reset', resetPassword);
router.post('/student/reset-password', resetPassword);
router.put('/student/reset-password', resetPassword);

router.post('/update-password', requireAuth, updatePassword);
router.put('/update-password', requireAuth, updatePassword);
router.patch('/update-password', requireAuth, updatePassword);

// -----------------------------
// USER PROFILE ENDPOINT
// -----------------------------
router.get('/me', requireAuth, getMe);

// -----------------------------
// ADMIN USER ROLE MANAGEMENT
// -----------------------------
router.patch('/users/:id/role', requireAdmin, updateUserRole);

module.exports = router;