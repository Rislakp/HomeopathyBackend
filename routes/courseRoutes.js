const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAdmin } = require('../middleware/rbac');

// Public course routes
router.get('/', courseController.getCourses);
router.get('/:id', courseController.getCourseById);

// Admin-only course management operations
router.post('/', requireAdmin, courseController.createCourse);
router.post('/:id/modules', requireAdmin, courseController.addModule);
router.put('/:id', requireAdmin, courseController.updateCourse);
router.delete('/:id', requireAdmin, courseController.deleteCourse);

module.exports = router;