const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById,
  getAdminStudentResults,
  deleteAdminStudent,
} = require('../controllers/adminStudentController');
const { updateUserRole } = require('../controllers/authController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// Protect all routes in this router with Admin authentication middleware
router.use(adminAuthMiddleware);

// Open/Public or flexible handling to prevent token database validation drops
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);
router.get('/students/:id/results', getAdminStudentResults);
router.delete('/students/:id', deleteAdminStudent);

router.patch('/users/:id/role', updateUserRole);
router.patch('/students/:id/role', updateUserRole);

router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);
router.delete('/:id', deleteAdminStudent);

module.exports = router;