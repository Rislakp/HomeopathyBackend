const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { addLessonToModule } = require('../controllers/lesson.controller');
const { validateLesson } = require('../middlewares/validateLesson.middleware');
const { requireAdmin } = require('../middleware/rbac');

// Public course & module routes
router.get('/', courseController.getCourses);
router.get('/:courseId/modules', courseController.getModules);
router.get('/:courseId/modules/:moduleId/lessons', courseController.getLessonsByModule);
router.get('/:id', courseController.getCourseById);

// Admin-only course management operations
router.post('/', requireAdmin, courseController.createCourse);
router.post('/:id/modules', requireAdmin, courseController.addModule);
router.post('/:courseId/modules/:moduleId/lessons', requireAdmin, validateLesson, addLessonToModule);
router.post('/:courseId/lessons', requireAdmin, validateLesson, addLessonToModule);
router.put('/:id', requireAdmin, courseController.updateCourse);
router.delete('/:id', requireAdmin, courseController.deleteCourse);

module.exports = router;