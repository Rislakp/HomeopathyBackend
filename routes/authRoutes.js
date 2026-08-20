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
} = require('../controllers/authController');

const { requireAuth, requireAdmin } = require('../middleware/rbac');

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
// PASSWORD MANAGEMENT (Direct Reset / Update without OTP)
// -----------------------------
router.post('/reset-password', resetPassword);
router.put('/reset-password', resetPassword);
router.patch('/reset-password', resetPassword);
router.post('/update-password', resetPassword);
router.put('/update-password', resetPassword);
router.patch('/update-password', resetPassword);
router.post('/forgot-password', resetPassword);
router.put('/forgot-password', resetPassword);
router.post('/password/reset', resetPassword);
router.put('/password/reset', resetPassword);
router.post('/student/reset-password', resetPassword);
router.put('/student/reset-password', resetPassword);

// -----------------------------
// USER PROFILE ENDPOINT
// -----------------------------
router.get('/me', requireAuth, getMe);

// -----------------------------
// ADMIN USER ROLE MANAGEMENT
// -----------------------------
router.patch('/users/:id/role', requireAdmin, updateUserRole);

module.exports = router;