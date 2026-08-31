const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

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