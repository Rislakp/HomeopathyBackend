const express = require('express');
const router = express.Router();
const recordingController = require('../controllers/recordingController');
const { requireAdmin, requireRole } = require('../middleware/rbac');
const requireAuthUser = requireRole('student', 'admin', 'superadmin');
const upload = require('../middleware/upload');
const { handleUploadError, processUploadsToCloudinary } = upload;

// Helper wrapper for Cloudinary multipart video upload
const handleRecordingUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    return processUploadsToCloudinary(req, res, next);
  });
};

// ── 1. POST /api/recordings ──────────────────────────────────────────────────
// Creates a new recording session entry when a lesson with "Record" flag is created
router.post('/recordings', requireAdmin, recordingController.createRecording);

// ── 2. GET /api/recordings ───────────────────────────────────────────────────
// Fetches all recording documents to populate the Live Records dashboard view
router.get('/recordings', requireAuthUser, recordingController.getRecordings);
router.get('/live-records', requireAuthUser, recordingController.getRecordings);

// ── 3. GET /api/recordings/:id ───────────────────────────────────────────────
// Fetches a single recording document by ID
router.get('/recordings/:id', requireAuthUser, recordingController.getRecordingById);
router.get('/live-records/:id', requireAuthUser, recordingController.getRecordingById);

// ── 4. PATCH /api/recordings/:id/status ──────────────────────────────────────
// Updates the recording status/lifecycle state in real time ('recording', 'paused', 'stopped')
router.patch('/recordings/:id/status', requireAdmin, recordingController.updateRecordingStatus);
// PUT alias — some clients send PUT instead of PATCH for status updates
router.put('/recordings/:id/status', requireAdmin, recordingController.updateRecordingStatus);

// ── 5. POST /api/recordings/:id/upload ───────────────────────────────────────
// Receives recorded video file from frontend FormData, uploads to Cloudinary, and updates record URL
router.post(
  '/recordings/:id/upload',
  requireAdmin,
  handleRecordingUpload,
  recordingController.uploadRecordingVideo
);

// ── 6. DELETE /api/recordings/:id ───────────────────────────────────────────
// Deletes recording document from MongoDB and removes video asset from Cloudinary
router.delete('/recordings/:id', requireAdmin, recordingController.deleteRecording);
router.delete('/live-records/:id', requireAdmin, recordingController.deleteRecording);

// Legacy route alias for course lesson recording upload
router.post(
  '/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings',
  requireAdmin,
  handleRecordingUpload,
  recordingController.createRecording
);

module.exports = router;
