const express = require('express');
const router = express.Router();
const adminStudentController = require('../controllers/adminStudent.controller');
const { adminAuth } = require('../middlewares/adminAuth.middleware');

/**
 * @route   GET /api/admin/students/export
 * @desc    Export student list with course details and exam scores as CSV file
 * @access  Private / Admin
 */
router.get('/export', adminAuth, adminStudentController.exportStudentsScores);

/**
 * @route   GET /api/admin/students
 * @desc    Get paginated student list for admin dashboard
 * @access  Private / Admin
 */
router.get('/', adminAuth, adminStudentController.getAdminStudents);

module.exports = router;
