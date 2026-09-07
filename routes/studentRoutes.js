const express = require('express');
const router = express.Router();

const facultyController = require('../controllers/facultyController');
const adminStudentController = require('../controllers/adminStudentController');
const { adminAuth } = require('../middleware/adminAuth.middleware');
const { requireAuth } = require('../middleware/rbac');
const {
  getProfile,
  updateProfile,
  deleteAccount,
} = require('../controllers/studentProfileController');

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY: Export scores (must come before parameterized routes)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export', adminAuth, adminStudentController.exportStudentsScores);

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT SELF-SERVICE PROFILE CRUD
// All routes require a valid JWT token (requireAuth).
// Students may only access their own profile; admins may access any.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/students/profile/:id
 * Fetch full student profile (User + Student document merged).
 */
router.get('/profile/:id', requireAuth, getProfile);

/**
 * PUT /api/students/profile/:id  (alias)
 * PATCH /api/students/profile/:id
 * Update allowed profile fields: name, contactNumber, qualification, preferredCourse, dateOfBirth.
 */
router.patch('/profile/:id', requireAuth, updateProfile);
router.put('/profile/:id', requireAuth, updateProfile);

/**
 * DELETE /api/students/profile/:id
 * Soft-deactivate account (default).
 * Hard delete: add ?hard=true (admin only).
 */
router.delete('/profile/:id', requireAuth, deleteAccount);

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT-FACING: Faculty info
// ─────────────────────────────────────────────────────────────────────────────
router.get('/faculty', facultyController.getStudentFaculty);
router.get('/faculty/:id', facultyController.getStudentFacultyById);

module.exports = router;