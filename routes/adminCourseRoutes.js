const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const recordingController = require('../controllers/recordingController');
const { requireAdmin } = require('../middleware/rbac');
const upload = require('../middleware/upload');
const { handleUploadError, processUploadsToCloudinary } = upload;

// Helper wrapper for file uploads with Cloudinary processing and error handling
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    return processUploadsToCloudinary(req, res, next);
  });
};

// All admin course routes require admin privileges
router.use(requireAdmin);

// ==========================================
// COURSE MANAGEMENT CRUD
// ==========================================
router.get('/', courseController.getCourses);
router.post('/', courseController.createCourse);
router.get('/:id', courseController.getCourseById);
router.put('/:id', courseController.updateCourse);
router.delete('/:id', courseController.deleteCourse);

// ==========================================
// MODULE MANAGEMENT CRUD
// ==========================================
router.get('/:courseId/modules', courseController.getModules);
router.post('/:courseId/modules', courseController.addModule);
router.put('/:courseId/modules/:moduleId', courseController.updateModule);
router.delete('/:courseId/modules/:moduleId', courseController.deleteModule);

// ==========================================
// LESSON MANAGEMENT CRUD
// ==========================================
router.get('/:courseId/modules/:moduleId/lessons', courseController.getLessonsByModule);
router.post('/:courseId/modules/:moduleId/lessons', handleUpload, courseController.addLesson);
router.put('/:courseId/modules/:moduleId/lessons/:lessonId', handleUpload, courseController.updateLesson);
router.delete('/:courseId/modules/:moduleId/lessons/:lessonId', courseController.deleteLesson);

// ==========================================
// RECORDING MANAGEMENT CRUD
// ==========================================
router.get('/live-records', recordingController.getLiveRecords);
router.post(
  '/:courseId/modules/:moduleId/lessons/:lessonId/recordings',
  handleUpload,
  recordingController.uploadRecording
);

module.exports = router;