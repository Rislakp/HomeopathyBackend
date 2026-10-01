const express = require('express');
const { requireAdmin, requireAuth } = require('../middleware/rbac');
const controller = require('../controllers/s3UploadController');

const router = express.Router();
router.post('/multipart/initiate', requireAdmin, controller.initiateMultipartUpload);
router.post('/multipart/part-url', requireAdmin, controller.partUrl);
router.post('/multipart/complete', requireAdmin, controller.completeMultipartUpload);
router.post('/multipart/abort', requireAdmin, controller.abortMultipartUpload);
router.post('/objects/presign', requireAdmin, controller.initiateObjectUpload);
router.post('/objects/complete', requireAdmin, controller.completeObjectUpload);
router.get('/media/access-url', requireAuth, controller.getMediaAccessUrl);
router.post('/media/access-url', requireAuth, controller.getMediaAccessUrl);

module.exports = router;
