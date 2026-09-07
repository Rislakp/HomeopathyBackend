const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById,
  getAdminStudentResults,
  updateAdminStudent,
  deleteAdminStudent,
  approveStudent,
  rejectStudent,
} = require('../controllers/adminStudentController');
const { updateUserRole } = require('../controllers/authController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// Protect all routes in this router with Admin authentication middleware
router.use(adminAuthMiddleware);

// ── Student list & details ──────────────────────────────────────────────────
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);
router.get('/students/:id/results', getAdminStudentResults);

// ── Approval / Status update (MUST be before the general /:id PUT) ──────────
/**
 * @route   PUT   /api/v1/admin/students/:id/approve
 * @route   PATCH /api/v1/admin/students/:id/approve
 * @desc    Approve, reject, suspend, or reset a student's accountStatus.
 *          Body: { accountStatus: 'Approved'|'Rejected'|'Suspended'|'Pending' }
 *          Omit body to default to Approved.
 * @access  Private / Admin
 */
router.put('/students/:id/approve', approveStudent);
router.patch('/students/:id/approve', approveStudent);
router.put('/students/:id/reject', rejectStudent);
router.patch('/students/:id/reject', rejectStudent);
router.put('/students/:id/status', approveStudent);
router.patch('/students/:id/status', approveStudent);

// ── Student CRUD ─────────────────────────────────────────────────────────────
router.put('/students/:id', updateAdminStudent);
router.patch('/students/:id', updateAdminStudent);
router.delete('/students/:id', deleteAdminStudent);

// ── Role management ──────────────────────────────────────────────────────────
router.patch('/users/:id/role', updateUserRole);
router.patch('/students/:id/role', updateUserRole);

// ── Short-form aliases (root-level, no /students prefix) ────────────────────
router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);
router.put('/:id', updateAdminStudent);
router.patch('/:id', updateAdminStudent);
router.delete('/:id', deleteAdminStudent);

module.exports = router;