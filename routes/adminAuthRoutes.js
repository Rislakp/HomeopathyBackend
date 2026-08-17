const express = require('express');
const router = express.Router();
const { adminLogin } = require('../controllers/adminAuthController');

// Route: POST /api/admin/auth/login
router.post('/login', adminLogin);

module.exports = router;
