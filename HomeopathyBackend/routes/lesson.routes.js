const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

// Subdocument module and lesson routes
router.post('/api/courses/:courseId/modules', courseController.addModule);
router.post('/api/courses/:courseId/modules/:moduleId/lessons', courseController.addLesson);
router.put('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', courseController.updateLesson);
router.delete('/api/courses/:courseId/modules/:moduleId/lessons/:lessonId', courseController.deleteLesson);

module.exports = router;
