const express = require('express');
const router = express.Router({ mergeParams: true });

const rankImageController = require('../controllers/academicExamRankImage.controller');
const { handleRankImageUpload } = require('../middleware/rankImageUpload.middleware');
const { requireAdmin, requireAuth } = require('../middleware/rbac');

/**
 * Academic Test History Ranked Students Image API Routes
 *
 * Exposes:
 *   POST   /api/exams/:examId/rank-image     (and /api/v1/exams/:examId/rank-image)
 *   GET    /api/exams/:examId/rank-image     (and /api/v1/exams/:examId/rank-image)
 *   PUT    /api/exams/:examId/rank-image     (and /api/v1/exams/:examId/rank-image)
 *   DELETE /api/exams/:examId/rank-image     (and /api/v1/exams/:examId/rank-image)
 */

// 1. POST — Upload Rank Image (Admin Only)
router.post(
  '/:examId/rank-image',
  requireAdmin,
  handleRankImageUpload,
  rankImageController.uploadRankImage
);

// 2. GET — Get Rank Image (Authenticated Admin or Student)
router.get(
  '/:examId/rank-image',
  requireAuth,
  rankImageController.getRankImage
);

// 3. PUT — Replace Rank Image (Admin Only)
router.put(
  '/:examId/rank-image',
  requireAdmin,
  handleRankImageUpload,
  rankImageController.replaceRankImage
);

// 4. DELETE — Delete Rank Image (Admin Only)
router.delete(
  '/:examId/rank-image',
  requireAdmin,
  rankImageController.deleteRankImage
);

module.exports = router;
