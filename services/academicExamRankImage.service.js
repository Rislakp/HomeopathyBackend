const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const AcademicExamRankImage = require('../models/academicExamRankImage.model');
const {
  uploadBufferToCloudinary,
  deleteCloudinaryByUrl,
  isCloudinaryConfigured,
  optimizeCloudinaryUrl
} = require('../config/cloudinary');

/**
 * Lazy load UnaniExam model to verify and reject Unani exams strictly
 */
const getUnaniExamModel = () => {
  try {
    return mongoose.models.UnaniExam || require('../src/unani/exams/models/unaniExam.model');
  } catch (e) {
    return null;
  }
};

/**
 * Helper error creator with HTTP status code
 */
const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * Validates that an examId corresponds to a valid, existing Academic Exam.
 * Rejects invalid ObjectId formats, missing exams, and Unani exams.
 */
const validateAcademicExam = async (examId) => {
  if (!examId || typeof examId !== 'string' || !mongoose.Types.ObjectId.isValid(examId)) {
    throw createHttpError('Invalid exam ID format.', 400);
  }

  // Check if ID belongs to a Unani exam
  const UnaniExam = getUnaniExamModel();
  if (UnaniExam) {
    const unaniExists = await UnaniExam.exists({ _id: examId });
    if (unaniExists) {
      throw createHttpError('Unani exams are not supported by Academic Rank Image API.', 400);
    }
  }

  // Query Academic Exam model
  const exam = await Exam.findById(examId).lean();
  if (!exam) {
    throw createHttpError('Academic exam not found.', 404);
  }

  // Explicit safety check on testType / courseId
  if (exam.testType === 'unani' || exam.courseId === 'unani') {
    throw createHttpError('Unani exams are not supported by Academic Rank Image API.', 400);
  }

  return exam;
};

/**
 * Fetch rank image record for an Academic exam
 */
const getRankImageByExamId = async (examId) => {
  await validateAcademicExam(examId);

  const rankImage = await AcademicExamRankImage.findOne({ examId }).lean();
  if (!rankImage) {
    throw createHttpError('Rank image not found', 404);
  }

  const optimizedUrl = optimizeCloudinaryUrl(rankImage.imageUrl);
  return {
    ...rankImage,
    id: rankImage._id.toString(),
    imageUrl: optimizedUrl,
  };
};

/**
 * Upload a new rank image for an Academic exam (POST)
 */
const uploadRankImage = async (examId, file, body = {}, adminUser = null) => {
  await validateAcademicExam(examId);

  // Enforce unique constraint: check if image already exists
  const existingRecord = await AcademicExamRankImage.findOne({ examId });
  if (existingRecord) {
    throw createHttpError('Rank image already exists for this exam. Use PUT to replace the image.', 409);
  }

  if (!file || (!file.buffer && !file.path)) {
    throw createHttpError('Image file is required.', 400);
  }

  let imageUrl = file.secure_url || file.url || file.path || '';
  let publicId = file.public_id || '';

  // Upload memory buffer to Cloudinary if not uploaded already by middleware
  if (!imageUrl.startsWith('http') && file.buffer) {
    if (!isCloudinaryConfigured() && process.env.NODE_ENV === 'production') {
      throw createHttpError('Cloudinary storage configuration is missing in production.', 500);
    }
    const uploadResult = await uploadBufferToCloudinary(file, 'homeopathy-media/rank-images', {
      resource_type: 'image',
      folder: 'homeopathy-media/rank-images',
    });
    imageUrl = uploadResult.secure_url;
    publicId = uploadResult.public_id;
  }

  if (!imageUrl) {
    throw createHttpError('Failed to process image upload.', 500);
  }

  const uploaderId = adminUser ? (adminUser.id || adminUser.userId || adminUser._id) : null;
  const altText = body && body.altText ? String(body.altText).trim() : 'Top Ranked Students';

  const newRankImage = await AcademicExamRankImage.create({
    examId,
    imageUrl,
    publicId,
    originalName: file.originalname || 'ranked-students.png',
    altText,
    uploadedBy: uploaderId && mongoose.Types.ObjectId.isValid(uploaderId) ? uploaderId : null,
  });

  return {
    id: newRankImage._id ? newRankImage._id.toString() : String(newRankImage.id),
    examId: newRankImage.examId ? newRankImage.examId.toString() : String(examId),
    imageUrl: optimizeCloudinaryUrl(newRankImage.imageUrl),
    publicId: newRankImage.publicId || '',
    originalName: newRankImage.originalName || '',
    altText: newRankImage.altText || '',
    uploadedAt: newRankImage.createdAt,
    uploadedBy: newRankImage.uploadedBy ? newRankImage.uploadedBy.toString() : null,
  };
};

/**
 * Replace an existing rank image for an Academic exam (PUT)
 */
const replaceRankImage = async (examId, file, body = {}, adminUser = null) => {
  await validateAcademicExam(examId);

  const existingRecord = await AcademicExamRankImage.findOne({ examId });
  if (!existingRecord) {
    throw createHttpError('Rank image not found', 404);
  }

  if (!file || (!file.buffer && !file.path)) {
    throw createHttpError('Image file is required.', 400);
  }

  const oldImageUrl = existingRecord.imageUrl;
  const oldPublicId = existingRecord.publicId;

  let newImageUrl = file.secure_url || file.url || file.path || '';
  let newPublicId = file.public_id || '';

  // 1. Upload new image to Cloudinary first
  if (!newImageUrl.startsWith('http') && file.buffer) {
    const uploadResult = await uploadBufferToCloudinary(file, 'homeopathy-media/rank-images', {
      resource_type: 'image',
      folder: 'homeopathy-media/rank-images',
    });
    newImageUrl = uploadResult.secure_url;
    newPublicId = uploadResult.public_id;
  }

  if (!newImageUrl) {
    throw createHttpError('Failed to process image upload.', 500);
  }

  // 2. Try updating database record
  try {
    const uploaderId = adminUser ? (adminUser.id || adminUser.userId || adminUser._id) : null;
    existingRecord.imageUrl = newImageUrl;
    existingRecord.publicId = newPublicId;
    existingRecord.originalName = file.originalname || 'ranked-students.png';
    if (body && body.altText) {
      existingRecord.altText = String(body.altText).trim();
    }
    if (uploaderId && mongoose.Types.ObjectId.isValid(uploaderId)) {
      existingRecord.uploadedBy = uploaderId;
    }

    await existingRecord.save();
  } catch (dbError) {
    // If DB update fails, clean up the newly uploaded Cloudinary image to prevent orphans
    if (newImageUrl && newImageUrl.includes('cloudinary.com')) {
      deleteCloudinaryByUrl(newImageUrl).catch(() => {});
    }
    throw dbError;
  }

  // 3. If DB update succeeded, delete the old physical image from Cloudinary
  if (oldImageUrl && oldImageUrl.includes('cloudinary.com')) {
    deleteCloudinaryByUrl(oldImageUrl).catch((err) => {
      console.warn('Notice: Could not delete old rank image from Cloudinary:', err.message);
    });
  }

  return {
    id: existingRecord._id ? existingRecord._id.toString() : String(existingRecord.id),
    examId: existingRecord.examId ? existingRecord.examId.toString() : String(examId),
    imageUrl: optimizeCloudinaryUrl(existingRecord.imageUrl),
    publicId: existingRecord.publicId || '',
    originalName: existingRecord.originalName || '',
    altText: existingRecord.altText || '',
    updatedAt: existingRecord.updatedAt,
  };
};

/**
 * Delete rank image record and remove file from Cloudinary (DELETE)
 */
const deleteRankImage = async (examId) => {
  await validateAcademicExam(examId);

  const existingRecord = await AcademicExamRankImage.findOne({ examId });
  if (!existingRecord) {
    throw createHttpError('Rank image not found', 404);
  }

  const imageUrl = existingRecord.imageUrl;

  // 1. Delete physical storage asset from Cloudinary
  if (imageUrl && imageUrl.includes('cloudinary.com')) {
    await deleteCloudinaryByUrl(imageUrl).catch((err) => {
      console.warn('Notice: Could not delete rank image asset from Cloudinary:', err.message);
    });
  }

  // 2. Remove database record (leaves Academic Exam, student records, and exam results intact)
  await AcademicExamRankImage.deleteOne({ _id: existingRecord._id });

  return true;
};

module.exports = {
  validateAcademicExam,
  getRankImageByExamId,
  uploadRankImage,
  replaceRankImage,
  deleteRankImage,
  createHttpError,
};
