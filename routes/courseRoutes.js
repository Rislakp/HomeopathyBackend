const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAdmin } = require('../middleware/rbac');

// Public course catalog view
router.get('/', courseController.getCourses);

// Admin-only course management operations
router.post('/', requireAdmin, courseController.createCourse);
router.put('/:id', requireAdmin, courseController.updateCourse);
router.delete('/:id', requireAdmin, courseController.deleteCourse);

module.exports = router;