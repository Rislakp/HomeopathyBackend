const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAdmin, requireAuth } = require('../middleware/rbac');
const { getMyCourseContent, updateLessonProgress, updateContentItemProgress, getMyProgress, saveCourseProgress, addStudyTime } = require('../controllers/studentCurriculumController');
const upload = require('../middleware/upload');
const { handleUploadError, processUploadsToCloudinary } = upload;

// Helper wrapper for optional file uploads with error handling
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    return processUploadsToCloudinary(req, res, next);
  });
};

// ==========================================
// COURSES ROOT CRUD
// ==========================================

// GET /api/courses - Fetch all courses
router.get('/', courseController.getCourses);

// POST /api/courses - Create a new course (supports multipart banner image upload)
router.post('/', requireAdmin, handleUpload, courseController.createCourse);

// GET /api/courses/:id - Fetch single course with complete modules & lessons tree
router.get('/:courseId/learn', requireAuth, getMyCourseContent);
router.get('/:courseId/progress', requireAuth, getMyProgress);
router.patch('/:courseId/modules/:moduleId/lessons/:lessonId/items/:itemId/progress', requireAuth, updateContentItemProgress);
router.patch('/:courseId/modules/:moduleId/lessons/:lessonId/progress', requireAuth, updateLessonProgress);
router.post('/:courseId/progress', requireAuth, saveCourseProgress);
router.post('/:courseId/study-time', requireAuth, addStudyTime);
router.get('/:id', courseController.getCourseById);

// PUT /api/courses/:id - Update course metadata (supports multipart banner image upload)
router.put('/:id', requireAdmin, handleUpload, courseController.updateCourse);

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
router.post('/:courseId/modules/:moduleId/lessons', requireAdmin, handleUpload, courseController.addLesson);

// PUT /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Update lesson inside module
router.put('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, handleUpload, courseController.updateLesson);

// DELETE /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Delete lesson from module
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, courseController.deleteLesson);

// ==========================================
// COURSE DEMO VIDEOS
// ==========================================
const demoVideoController = require('../controllers/demoVideoController');

// GET /api/courses/:courseId/demo-videos (or /api/v1/courses/:courseId/demo-videos)
router.get('/:courseId/demo-videos', demoVideoController.getCourseDemoVideos);

module.exports = router;

