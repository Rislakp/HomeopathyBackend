const express = require('express');
const router = express.Router();
const { adminLogin, registerAdmin } = require('../controllers/adminAuthController');
const { resetPassword } = require('../controllers/authController');

// Route: POST /api/admin/auth/register
router.post('/register', registerAdmin);

// Route: POST /api/admin/auth/login
router.post('/login', adminLogin);

// Route: Password reset / update for admin portal
router.post('/reset-password', resetPassword);
router.put('/reset-password', resetPassword);
router.patch('/reset-password', resetPassword);
router.post('/update-password', resetPassword);
router.put('/update-password', resetPassword);
router.patch('/update-password', resetPassword);

module.exports = router;
