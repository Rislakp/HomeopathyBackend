const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAdmin } = require('../middleware/rbac');

// ==========================================
// COURSES ROOT CRUD
// ==========================================

// GET /api/courses - Fetch all courses
router.get('/', courseController.getCourses);

// POST /api/courses - Create a new course
router.post('/', requireAdmin, courseController.createCourse);

// GET /api/courses/:id - Fetch single course with complete modules & lessons tree
router.get('/:id', courseController.getCourseById);

// PUT /api/courses/:id - Update course metadata
router.put('/:id', requireAdmin, courseController.updateCourse);

// DELETE /api/courses/:id - Delete course
router.delete('/:id', requireAdmin, courseController.deleteCourse);


// ==========================================
// MODULES SUBDOCUMENT CRUD
// ==========================================

// GET /api/courses/:courseId/modules - Get all modules for a course
router.get('/:courseId/modules', courseController.getModules);

// POST /api/courses/:courseId/modules - Add module to course
router.post('/:courseId/modules', requireAdmin, courseController.addModule);

// PUT /api/courses/:courseId/modules/:moduleId - Update module
router.put('/:courseId/modules/:moduleId', requireAdmin, courseController.updateModule);

// DELETE /api/courses/:courseId/modules/:moduleId - Delete module
router.delete('/:courseId/modules/:moduleId', requireAdmin, courseController.deleteModule);


// ==========================================
// NESTED LESSONS SUBDOCUMENT CRUD
// ==========================================

// GET /api/courses/:courseId/modules/:moduleId/lessons - Get all lessons for a module
router.get('/:courseId/modules/:moduleId/lessons', courseController.getLessonsByModule);

// POST /api/courses/:courseId/modules/:moduleId/lessons - Add lesson to module
router.post('/:courseId/modules/:moduleId/lessons', requireAdmin, courseController.addLesson);

// PUT /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Update lesson inside module
router.put('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, courseController.updateLesson);

// DELETE /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Delete lesson from module
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, courseController.deleteLesson);

module.exports = router;