const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');

// Student-facing faculty endpoints
router.get('/student', facultyController.getStudentFaculty);
router.get('/student/:id', facultyController.getStudentFacultyById);

// Admin-facing faculty endpoints
router.get('/', facultyController.getAllFacultyAdmin);
router.post('/', facultyController.createFaculty);
router.put('/:id', facultyController.updateFaculty);
router.delete('/:id', facultyController.deleteFaculty);

module.exports = router;
