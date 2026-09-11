const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');
const {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  getMyProgress,
} = require('../controllers/studentCurriculumController');

// All student curriculum routes require authentication
router.use(requireAuth);

// GET student course list
router.get('/courses', getMyCourses);

// GET full course content (subscription-gated)
router.get('/courses/:courseId/learn', getMyCourseContent);

// GET course progress
router.get('/courses/:courseId/progress', getMyProgress);

// PATCH lesson progress (watch position, completed status, PDF downloaded)
router.patch('/courses/:courseId/modules/:moduleId/lessons/:lessonId/progress', updateLessonProgress);

module.exports = router;
