const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new student or admin
 */
router.post('/register', register);

/**
 * @route   POST /api/auth/login
 * @desc    Login student or admin with role validation
 */
router.post('/login', login);

/**
 * @route   GET /api/auth/me
 * @desc    Get currently authenticated user
 */
router.get('/me', authMiddleware, getMe);

module.exports = router;
