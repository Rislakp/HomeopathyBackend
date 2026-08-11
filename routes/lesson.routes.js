const express = require('express');
const router = express.Router();
const { validateLesson } = require('../middlewares/validateLesson.middleware');
const { 
  addModuleToCourse, 
  addLessonToModule,
  getLesson,
  updateLesson,
  deleteLesson
} = require('../controllers/lesson.controller');

router.post('/api/courses/:courseId/modules', validateLesson, addModuleToCourse);
router.post('/api/courses/:courseId/lessons', validateLesson, addLessonToModule);

router.get('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', getLesson);
router.put('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', updateLesson);
router.delete('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', deleteLesson);

module.exports = router;
