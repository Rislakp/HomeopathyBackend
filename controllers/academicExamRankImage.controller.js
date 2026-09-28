const rankImageService = require('../services/academicExamRankImage.service');

/**
 * Controller error handler helper mapping custom error statusCodes to HTTP responses
 */
const handleControllerError = (err, res) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500) {
    console.error('Academic Exam Rank Image API Error:', err);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500 ? { error: err.stack } : {}),
  });
};

/**
 * POST /api/exams/:examId/rank-image
 * Uploads a rank image for an Academic exam
 */
const uploadRankImage = async (req, res) => {
  try {
    const { examId } = req.params;
    const file = req.file || (req.files ? (Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0]) : null);

    const result = await rankImageService.uploadRankImage(examId, file, req.body, req.user || req.admin);

    return res.status(200).json({
      success: true,
      message: 'Rank image uploaded successfully',
      data: result,
    });
  } catch (err) {
    return handleControllerError(err, res);
  }
};

/**
 * GET /api/exams/:examId/rank-image
 * Fetches the rank image associated with an Academic exam
 */
const getRankImage = async (req, res) => {
  try {
    const { examId } = req.params;
    const data = await rankImageService.getRankImageByExamId(examId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return handleControllerError(err, res);
  }
};

/**
 * PUT /api/exams/:examId/rank-image
 * Replaces an existing rank image for an Academic exam
 */
const replaceRankImage = async (req, res) => {
  try {
    const { examId } = req.params;
    const file = req.file || (req.files ? (Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0]) : null);

    const result = await rankImageService.replaceRankImage(examId, file, req.body, req.user || req.admin);

    return res.status(200).json({
      success: true,
      message: 'Rank image updated successfully',
      data: result,
    });
  } catch (err) {
    return handleControllerError(err, res);
  }
};

/**
 * DELETE /api/exams/:examId/rank-image
 * Deletes the rank image record and removes physical asset from Cloudinary
 */
const deleteRankImage = async (req, res) => {
  try {
    const { examId } = req.params;
    await rankImageService.deleteRankImage(examId);

    return res.status(200).json({
      success: true,
      message: 'Rank image deleted successfully',
    });
  } catch (err) {
    return handleControllerError(err, res);
  }
};

module.exports = {
  uploadRankImage,
  getRankImage,
  replaceRankImage,
  deleteRankImage,
};
