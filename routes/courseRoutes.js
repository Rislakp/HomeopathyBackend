const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

router.get('/', courseController.getCourses);

router.post('/', courseController.createCourse);

router.put('/:courseId', courseController.updateCourse);

router.delete('/:courseId', courseController.deleteCourse);

module.exports = router;