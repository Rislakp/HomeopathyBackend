const express = require('express');
const router = express.Router();
const recordingController = require('../controllers/recordingController');
const { requireAdmin } = require('../middleware/rbac');
const upload = require('../middleware/upload');
const { processUploadsToCloudinary } = upload;

// Helper wrapper for video recording multipart uploads
const handleRecordingUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Recording upload error' });
    }
    return processUploadsToCloudinary(req, res, next);
  });
};

// GET /api/live-records & /api/courses/live-records
router.get('/live-records', recordingController.getLiveRecords);
router.get('/courses/live-records', recordingController.getLiveRecords);

// POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings
router.post(
  '/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings',
  requireAdmin,
  handleRecordingUpload,
  recordingController.uploadRecording
);

// DELETE /api/recordings/:id
router.delete('/recordings/:id', requireAdmin, recordingController.deleteRecording);

module.exports = router;
