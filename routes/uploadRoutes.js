const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const upload = require('../middleware/upload');
const { handleUploadError, processUploadsToCloudinary } = upload;

// Flexible wrapper that accepts multiple files under 'files', 'images', 'file', 'image', or any field name
const handleFileUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    return processUploadsToCloudinary(req, res, next);
  });
};


// GET /api/media or GET /api/upload - List stored Cloudinary assets
router.get('/', uploadController.getMediaAssets);
router.get('/media', uploadController.getMediaAssets);
router.get('/list', uploadController.getMediaAssets);

// POST /api/upload - Multiple or single file upload to Cloudinary
router.post('/', handleFileUpload, uploadController.uploadFiles);

// POST /api/upload/multiple - Explicit alias for array uploads
router.post('/multiple', handleFileUpload, uploadController.uploadFiles);

// POST /api/upload/single - Explicit alias for single upload
router.post('/single', handleFileUpload, uploadController.uploadFiles);

// DELETE /api/upload - Delete uploaded file from Cloudinary
router.delete('/', uploadController.deleteFile);

module.exports = router;

