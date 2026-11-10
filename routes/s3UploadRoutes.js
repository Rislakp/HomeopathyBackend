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
router.get('/media/refresh-cookies', requireAuth, controller.refreshHlsCookies);
router.post('/media/refresh-cookies', requireAuth, controller.refreshHlsCookies);
router.post('/media/refresh-hls-cookies', requireAuth, controller.refreshHlsCookies);
router.get('/conversion-status', requireAuth, controller.getVideoConversionStatus);
router.post('/retry-conversion', requireAdmin, controller.retryVideoConversion);
router.post('/batch-convert', requireAdmin, controller.batchConvertCourseVideos);

// AWS Elemental MediaConvert HLS endpoints
router.post('/mediaconvert/webhook', controller.handleMediaConvertWebhook);
router.get('/mediaconvert/status/:keyOrJobId', requireAuth, controller.getMediaConvertJobStatus);
router.get('/mediaconvert/status', requireAuth, controller.getMediaConvertJobStatus);
router.post('/mediaconvert/retry', requireAdmin, controller.retryMediaConvertJob);

module.exports = router;
