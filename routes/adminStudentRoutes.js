const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  createStudent,
  exportStudentsScores,
  approveStudent,
} = require('../controllers/adminStudentController');
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
router.get('/export', exportStudentsScores);

/**
 * @route   GET /api/admin/students
 * @desc    Get paginated student list for admin dashboard
 * @access  Private / Admin
 */
router.get('/', getAdminStudents);

/**
 * @route   POST /api/admin/students
 * @desc    Create a new student
 * @access  Private / Admin
 */
router.post('/', createStudent);

// =========================================================================
// 2. SPECIFIC ACTION ROUTES (must be before /:id catch-all)
// =========================================================================

/**
 * @route   PUT   /api/admin/students/:id/approve
 * @route   PATCH /api/admin/students/:id/approve
 * @route   PUT   /api/v1/admin/students/:id/approve
 * @desc    Approve, reject, suspend, or set a student's account status.
 *          Body: { accountStatus: 'Approved'|'Rejected'|'Suspended'|'Pending', isApproved?: Boolean }
 *          No body needed for quick Approve — defaults to accountStatus: 'Approved'.
 * @access  Private / Admin
 */
router.put('/:id/approve', approveStudent);
router.patch('/:id/approve', approveStudent);

/**
 * @route   PUT   /api/admin/students/:id/status
 * @route   PATCH /api/admin/students/:id/status
 * @desc    Alias for the approve route — update student account status.
 * @access  Private / Admin
 */
router.put('/:id/status', approveStudent);
router.patch('/:id/status', approveStudent);

// =========================================================================
// 3. DYNAMIC PARAMETER ROUTES
// =========================================================================

/**
 * @route   GET /api/admin/students/:id
 * @desc    Get single student details by MongoDB ID
 * @access  Private / Admin
 */
router.get('/:id', getStudentById);

/**
 * @route   PUT /api/admin/students/:id
 * @desc    Update student details by ID
 * @access  Private / Admin
 */
router.put('/:id', updateStudent);

/**
 * @route   DELETE /api/admin/students/:id
 * @desc    Delete student by ID
 * @access  Private / Admin
 */
router.delete('/:id', deleteStudent);

module.exports = router;
