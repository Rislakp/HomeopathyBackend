const express = require('express');
const router = express.Router();
const { validateLesson } = require('../middlewares/validateLesson.middleware');
const { requireAdmin } = require('../middleware/rbac');
const {
  addModuleToCourse,
  addLessonToModule,
  getLesson,
  updateLesson,
  deleteLesson,
} = require('../controllers/lesson.controller');

// Admin-only module & lesson creation
router.post(
  '/api/courses/:courseId/modules',
  requireAdmin,
  validateLesson,
  addModuleToCourse
);
router.post(
  '/api/courses/:courseId/lessons',
  requireAdmin,
  validateLesson,
  addLessonToModule
);

// Lesson viewing (accessible)
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

module.exports = router;
