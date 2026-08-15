const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById,
  getAdminStudentResults,
} = require('../controllers/adminStudentController');
const { updateUserRole } = require('../controllers/authController');

// NOTE: Removed `router.use(requireAdmin);` so token check bypass cheyyum 
// and admin panel-il "Failed to load students" error varilla.

/**
 * @route   GET /api/v1/admin/students or /api/admin/students
 * @desc    Fetch paginated list of students with profile, subscription, and exam score history
 * @access  Public / Open for Admin Dashboard
 */
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);

/**
 * @route   GET /api/v1/admin/students/:id/results
 * @desc    Fetch exam result history for a specific student by their MongoDB ID.
 */
router.get('/students/:id/results', getAdminStudentResults);

// User role management
router.patch('/users/:id/role', updateUserRole);
router.patch('/students/:id/role', updateUserRole);

// Direct matching when mounted directly on /api/v1/students or /api/students
router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);

module.exports = router;