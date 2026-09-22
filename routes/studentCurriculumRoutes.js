const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');
const {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  getMyProgress,
  saveCourseProgress,
  addStudyTime,
} = require('../controllers/studentCurriculumController');

// All student curriculum routes require authentication
router.use(requireAuth);

// GET student course list
router.get('/courses', getMyCourses);

// GET student course list
router.get('/', getMyCourses);

// GET full course content (subscription-gated)
router.get('/courses/:courseId/learn', getMyCourseContent);
router.get('/:courseId/learn', getMyCourseContent);

// GET course progress
router.get('/courses/:courseId/progress', getMyProgress);
router.get('/:courseId/progress', getMyProgress);
router.post('/courses/:courseId/progress', saveCourseProgress);
router.post('/:courseId/progress', saveCourseProgress);
router.post('/courses/:courseId/study-time', addStudyTime);
router.post('/:courseId/study-time', addStudyTime);

// PATCH lesson progress (watch position, completed status, PDF downloaded)
router.patch('/courses/:courseId/modules/:moduleId/lessons/:lessonId/progress', updateLessonProgress);
router.patch('/:courseId/modules/:moduleId/lessons/:lessonId/progress', updateLessonProgress);

module.exports = router;
