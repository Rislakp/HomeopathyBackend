const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');
const adminStudentController = require('../controllers/adminStudent.controller');
const { adminAuth } = require('../middlewares/adminAuth.middleware');

// Export route placed at top before any parameterized routes
router.get('/export', adminAuth, adminStudentController.exportStudentsScores);

// Student Faculty Routes
router.get('/faculty', facultyController.getStudentFaculty);
router.get('/faculty/:id', facultyController.getStudentFacultyById);

module.exports = router;