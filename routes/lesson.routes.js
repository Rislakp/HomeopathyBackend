const express = require('express');
const router = express.Router();
const { validateLesson } = require('../middlewares/validateLesson.middleware');
const { addModuleToCourse } = require('../controllers/lesson.controller');

router.post('/api/courses/:courseId/modules', validateLesson, addModuleToCourse);

module.exports = router;
