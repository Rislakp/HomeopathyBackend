const express = require('express');
const router = express.Router();

const {
  signup,
  register,
  registerStudent,
  login,
  getMe,
} = require('../controllers/authController');

const authMiddleware = require('../middleware/authMiddleware');

// User Registration (Signup)
router.post('/signup', signup);
router.post('/register', register);

// Student profile registration
router.post('/register-student', registerStudent);

// Login
router.post('/login', login);

// Current logged-in user profile
router.get('/me', authMiddleware, getMe);

module.exports = router;