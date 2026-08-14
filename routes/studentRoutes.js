const express = require('express');
const router = express.Router();
const {
  getAdminStudents,
  getAdminStudentById
} = require('../controllers/adminStudentController');

router.get('/', getAdminStudents);
router.get('/:id', getAdminStudentById);

module.exports = router;