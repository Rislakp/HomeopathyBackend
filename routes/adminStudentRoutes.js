const express = require('express');
const router = express.Router();
const adminStudentController = require('../controllers/adminStudentController');
const { adminAuth } = require('../middleware/adminAuth.middleware');

// Apply admin authentication middleware to all admin student endpoints
router.use(adminAuth);

// =========================================================================
// 1. STATIC ROUTES (MUST be declared at top before any /:id routes)
// =========================================================================

/**
 * @route   GET /api/admin/students/export
 * @desc    Export student list with course details and exam scores as CSV file
 * @access  Private / Admin
 * @note    CRITICAL: This route MUST remain above /:id to prevent Express from treating 'export' as a MongoDB ID
 */
router.get('/export', adminStudentController.exportStudentsScores);

/**
 * @route   GET /api/admin/students
 * @desc    Get paginated student list for admin dashboard
 * @access  Private / Admin
 */
router.get('/', adminStudentController.getAdminStudents);

/**
 * @route   POST /api/admin/students
 * @desc    Create a new student
 * @access  Private / Admin
 */
router.post('/', adminStudentController.createStudent);

// =========================================================================
// 2. DYNAMIC PARAMETER ROUTES
// =========================================================================

/**
 * @route   GET /api/admin/students/:id
 * @desc    Get single student details by MongoDB ID
 * @access  Private / Admin
 */
router.get('/:id', adminStudentController.getStudentById);

/**
 * @route   PUT /api/admin/students/:id
 * @desc    Update student details by ID
 * @access  Private / Admin
 */
router.put('/:id', adminStudentController.updateStudent);

/**
 * @route   DELETE /api/admin/students/:id
 * @desc    Delete student by ID
 * @access  Private / Admin
 */
router.delete('/:id', adminStudentController.deleteStudent);

module.exports = router;
