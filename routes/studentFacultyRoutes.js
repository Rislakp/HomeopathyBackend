const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');

/**
 * @route   GET /api/student/faculty
 * @desc    Fetch active faculty members with search, department filter, and pagination
 * @access  Public / Student
 */
router.get('/', facultyController.getStudentFaculty);

/**
 * @route   GET /api/student/faculty/:id
 * @desc    Fetch a single active faculty member's profile by ID
 * @access  Public / Student
 */
router.get('/:id', facultyController.getStudentFacultyById);

module.exports = router;
