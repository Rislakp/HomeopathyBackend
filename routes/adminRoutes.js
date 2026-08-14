const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById
} = require('../controllers/adminStudentController');

/**
 * @route   GET /api/v1/admin/students or /api/admin/students or /api/v1/students
 * @desc    Fetch paginated list of students with profile, subscription, and exam score history
 * @access  Public
 */
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);

// Direct matching when mounted directly on /api/v1/students or /api/students
router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);

module.exports = router;

