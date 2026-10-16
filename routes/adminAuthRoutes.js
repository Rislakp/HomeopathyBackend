const express = require('express');
const router = express.Router();
const { adminLogin, registerAdmin } = require('../controllers/adminAuthController');
const { resetPassword, refreshTokenHandler } = require('../controllers/authController');

// Route: POST /api/admin/auth/register
router.post('/register', registerAdmin);

// Route: POST /api/admin/auth/login
router.post('/login', adminLogin);

// Route: POST /api/admin/auth/refresh
router.post('/refresh', refreshTokenHandler);
router.post('/refresh-token', refreshTokenHandler);

// Route: Password reset / update for admin portal
router.post('/reset-password', resetPassword);
router.put('/reset-password', resetPassword);
router.patch('/reset-password', resetPassword);
// Note: update-password omitted here since it requires auth; typically handled in authRoutes.

module.exports = router;
