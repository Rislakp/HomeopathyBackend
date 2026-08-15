const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById,
  getAdminStudentResults,
} = require('../controllers/adminStudentController');
const { updateUserRole } = require('../controllers/authController');

// Open/Public or flexible handling to prevent token database validation drops
router.get('/students', getAdminStudents);
router.get('/students/:id', getAdminStudentById);
router.get('/students/:id/results', getAdminStudentResults);

router.patch('/users/:id/role', updateUserRole);
router.patch('/students/:id/role', updateUserRole);

router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);

module.exports = router;