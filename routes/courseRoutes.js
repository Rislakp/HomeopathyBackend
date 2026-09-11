const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { requireAdmin } = require('../middleware/rbac');

// ==========================================
// COURSES ROOT CRUD
// ==========================================

// GET /api/courses - Fetch all courses
router.get('/', courseController.getCourses);

// POST /api/courses - Create a new course
router.post('/', requireAdmin, courseController.createCourse);

// GET /api/courses/:id - Fetch single course with complete modules & lessons tree
router.get('/:id', courseController.getCourseById);

// PUT /api/courses/:id - Update course metadata
router.put('/:id', requireAdmin, courseController.updateCourse);

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


// GET /api/courses/:courseId/modules/:moduleId/lessons - Get all lessons for a module
router.get('/:courseId/modules/:moduleId/lessons', courseController.getLessonsByModule);

// POST /api/courses/:courseId/modules/:moduleId/lessons - Add lesson to module
router.post('/:courseId/modules/:moduleId/lessons', requireAdmin, handleUpload, courseController.addLesson);

// PUT /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Update lesson inside module
router.put('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, handleUpload, courseController.updateLesson);

// DELETE /api/courses/:courseId/modules/:moduleId/lessons/:lessonId - Delete lesson from module
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId', requireAdmin, courseController.deleteLesson);

// ==========================================
// LIVE RECORDINGS SUBDOCUMENT CRUD
// ==========================================
const recordingController = require('../controllers/recordingController');

// GET /api/courses/live-records
router.get('/live-records', recordingController.getLiveRecords);

// POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings
router.post(
  '/:courseId/modules/:moduleId/lessons/:lessonId/recordings',
  requireAdmin,
  handleUpload,
  recordingController.uploadRecording
);

module.exports = router;
