const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/facultyController');
const { requireAdmin } = require('../middleware/rbac');

// Student-facing faculty endpoints
router.get('/student', facultyController.getStudentFaculty);
router.get('/student/:id', facultyController.getStudentFacultyById);

// Admin-facing faculty endpoints
router.use(requireAdmin);
router.get('/', facultyController.getAllFacultyAdmin);
router.post('/', facultyController.createFaculty);
router.put('/:id', facultyController.updateFaculty);
router.delete('/:id', facultyController.deleteFaculty);

module.exports = router;
