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

// ==========================================
// COURSES ROOT CRUD
// ==========================================

// GET /api/courses - Fetch all courses
router.get('/', courseController.getCourses);

// POST /api/courses - Create a new course
router.post('/', courseController.createCourse);

// GET /api/courses/:id - Fetch single course with complete modules & lessons tree
router.get('/:id', courseController.getCourseById);

// PUT /api/courses/:id - Update course metadata
router.put('/:id', courseController.updateCourse);

// DELETE /api/courses/:id - Delete course
router.delete('/:id', courseController.deleteCourse);

// ==========================================
// MODULES SUBDOCUMENT CRUD
// ==========================================

// POST /api/courses/:courseId/modules - Add module to course
router.post('/:courseId/modules', courseController.addModule);

// PUT /api/courses/:courseId/modules/:moduleId - Update module
router.put('/:courseId/modules/:moduleId', courseController.updateModule);

// DELETE /api/courses/:courseId/modules/:moduleId - Delete module
router.delete('/:courseId/modules/:moduleId', courseController.deleteModule);

// ==========================================
// NESTED LESSONS SUBDOCUMENT CRUD
// ==========================================

// POST /api/courses/:courseId/modules/:moduleId/lessons - Add lesson to module
router.post('/:courseId/modules/:moduleId/lessons', courseController.addLesson);

// PUT /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Update lesson inside module
router.put('/:courseId/modules/:moduleId/lessons/:lessonId', courseController.updateLesson);

// DELETE /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Delete lesson from module
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId', courseController.deleteLesson);

module.exports = router;