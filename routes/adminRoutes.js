const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById,
} = require('../controllers/adminStudentController');
const { updateUserRole } = require('../controllers/authController');
const { requireAdmin } = require('../middleware/rbac');

// Protect all admin student routes with requireAdmin (admin & superadmin only)
router.use(requireAdmin);

/**
 * @route   GET /api/v1/admin/students or /api/admin/students
 * @desc    Fetch paginated list of students with profile, subscription, and exam score history
 * @access  Private (Admin Only)
 */
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);

// User role management by Admin
router.patch('/users/:id/role', updateUserRole);
router.patch('/students/:id/role', updateUserRole);

// Direct matching when mounted directly on /api/v1/students or /api/students
router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);

module.exports = router;
