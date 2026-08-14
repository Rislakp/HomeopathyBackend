const express = require('express');
const router = express.Router();

const {
  registerStudent,
  studentLogin,
  adminLogin,
  getMe,
} = require('../controllers/authController');

const authMiddleware = require('../middleware/authMiddleware');

// -----------------------------
// STUDENT REGISTRATION ENDPOINTS
// -----------------------------
router.post('/register', registerStudent);
router.post('/student/signup', registerStudent);
router.post('/signup', registerStudent);
router.post('/register-student', registerStudent);

// -----------------------------
// STUDENT LOGIN ENDPOINTS
// -----------------------------
router.post('/login', studentLogin);
router.post('/student/login', studentLogin);

// -----------------------------
// ADMIN LOGIN ENDPOINT
// -----------------------------
router.post('/admin/login', adminLogin);

// -----------------------------
// USER PROFILE ENDPOINT
// -----------------------------
router.get('/me', authMiddleware, getMe);

module.exports = router;