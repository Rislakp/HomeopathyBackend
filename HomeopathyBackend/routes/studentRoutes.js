const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');

// Student Faculty Routes
router.get('/faculty', facultyController.getStudentFaculty);
router.get('/faculty/:id', facultyController.getStudentFacultyById);

module.exports = router;