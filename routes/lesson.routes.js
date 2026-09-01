const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

// Admin-only module & lesson creation
router.post(
  '/api/courses/:courseId/modules',
  requireAdmin,
  validateLesson,
  addModuleToCourse
);
router.post(
  '/api/courses/:courseId/modules/:moduleId/lessons',
  requireAdmin,
  validateLesson,
  addLessonToModule
);
router.post(
  '/api/courses/:courseId/lessons',
  requireAdmin,
  validateLesson,
  addLessonToModule
);

// Module & Lesson viewing
router.get(
  '/api/courses/:courseId/modules',
  require('../controllers/courseController').getModules
);
router.get(
  '/api/courses/:courseId/modules/:moduleId/lessons',
  require('../controllers/courseController').getLessonsByModule
);
router.get(
  '/api/courses/:courseId/modules/:moduleId/lessons/:lessonId',
  getLesson
);

// Admin-only lesson update and deletion
router.put(
  '/api/courses/:courseId/modules/:moduleId/lessons/:lessonId',
  requireAdmin,
  updateLesson
);
router.delete(
  '/api/courses/:courseId/modules/:moduleId/lessons/:lessonId',
  requireAdmin,
  deleteLesson
);
// Subdocument module and lesson routes
router.post('/api/courses/:courseId/modules', courseController.addModule);
router.post('/api/courses/:courseId/modules/:moduleId/lessons', courseController.addLesson);
router.put('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', courseController.updateLesson);
router.delete('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', courseController.deleteLesson);

module.exports = router;
