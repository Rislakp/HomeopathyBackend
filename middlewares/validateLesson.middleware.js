const mongoose = require('mongoose');

const validateLesson = (req, res, next) => {
  const { courseId } = req.params;
  
  // Support both mediaContent and uploadFileOrLink
  if (req.body.mediaContent && !req.body.uploadFileOrLink) {
    req.body.uploadFileOrLink = req.body.mediaContent;
  }
  
  const { lessonTitle, uploadFileOrLink, lessonType } = req.body;

  // Validate courseId is a valid custom courseId format
  if (!courseId) {
    return res.status(400).json({
      success: false,
      message: 'courseId is required'
    });
  }

  const courseIdRegex = /^CRS-\d{6}$/;
  if (!courseIdRegex.test(courseId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid courseId format'
    });
  }

  // Validate lessonTitle
  if (!lessonTitle) {
    return res.status(400).json({
      success: false,
      message: 'lessonTitle is required'
    });
  }

  if (typeof lessonTitle !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'lessonTitle must be a string'
    });
  }

  const trimmedTitle = lessonTitle.trim();
  if (trimmedTitle.length < 3 || trimmedTitle.length > 150) {
    return res.status(400).json({
      success: false,
      message: 'lessonTitle must be between 3 and 150 characters'
    });
  }

  // Validate uploadFileOrLink
  if (!uploadFileOrLink) {
    return res.status(400).json({
      success: false,
      message: 'uploadFileOrLink is required'
    });
  }

  if (typeof uploadFileOrLink !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'uploadFileOrLink must be a string'
    });
  }

  // URL format validation using new URL()
  let isValidUrl = false;
  try {
    new URL(uploadFileOrLink);
    isValidUrl = true;
  } catch (_) {
    isValidUrl = false;
  }

  if (!isValidUrl) {
    return res.status(400).json({
      success: false,
      message: 'uploadFileOrLink must be a valid URL string'
    });
  }

  // Validate lessonType
  const allowedTypes = ['video', 'pdf', 'link', 'document', 'audio'];
  if (!lessonType) {
    return res.status(400).json({
      success: false,
      message: 'lessonType is required'
    });
  }

  if (!allowedTypes.includes(lessonType)) {
    return res.status(400).json({
      success: false,
      message: `lessonType must be one of: ${allowedTypes.join(', ')}`
    });
  }

  next();
};

module.exports = { validateLesson };
