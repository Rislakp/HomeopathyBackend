const mongoose = require('mongoose');
const UnaniReview = require('../models/unaniReview.model');
const { resolveProfileImageUrl } = require('../../../../utils/s3MediaSigner');

/**
 * Create a new Unani Review (Admin only)
 * Completely independent of exams, results, ranks.
 */
async function createReview(payload = {}) {
  const reviewData = {
    name: payload.name ? payload.name.trim() : '',
    subtitle: payload.subtitle ? payload.subtitle.trim() : '',
    review: payload.review ? payload.review.trim() : '',
    rating: payload.rating !== undefined && payload.rating !== null && payload.rating !== ''
      ? Number(payload.rating)
      : 5,
    profileImage: payload.profileImage ? payload.profileImage.trim() : '',
    displayOrder: payload.displayOrder !== undefined && payload.displayOrder !== null
      ? Number(payload.displayOrder)
      : 0,
    isActive: payload.isActive !== undefined
      ? Boolean(payload.isActive === true || payload.isActive === 'true')
      : true,
    courseId: 'unani',
    isDeleted: false,
  };

  const newReview = new UnaniReview(reviewData);
  await newReview.save();
  const obj = newReview.toObject({ virtuals: true });
  obj.profileImage = await resolveProfileImageUrl(obj.profileImage);
  return obj;
}

/**
 * List all Unani Reviews for Admin (Supports pagination, search, status filter)
 */
async function getAdminReviews({ page = 1, limit = 20, search = '', isActive, sort } = {}) {
  const filter = {
    courseId: 'unani',
    isDeleted: { $ne: true },
  };

  if (isActive !== undefined && isActive !== null && isActive !== '') {
    filter.isActive = String(isActive).toLowerCase() === 'true';
  }

  if (search && typeof search === 'string' && search.trim()) {
    const sRegex = new RegExp(search.trim(), 'i');
    filter.$or = [
      { name: sRegex },
      { subtitle: sRegex },
      { review: sRegex },
    ];
  }

  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  // Determine sort order
  let sortObj = { displayOrder: 1, createdAt: -1 };
  if (sort) {
    const sortStr = String(sort).toLowerCase().trim();
    if (sortStr === 'createdat' || sortStr === 'createdat_desc') {
      sortObj = { createdAt: -1 };
    } else if (sortStr === 'createdat_asc') {
      sortObj = { createdAt: 1 };
    } else if (sortStr === 'updatedat' || sortStr === 'updatedat_desc') {
      sortObj = { updatedAt: -1 };
    } else if (sortStr === 'displayorder' || sortStr === 'displayorder_asc') {
      sortObj = { displayOrder: 1, createdAt: -1 };
    }
  }

  const [reviews, total] = await Promise.all([
    UnaniReview.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    UnaniReview.countDocuments(filter),
  ]);

  const formattedReviews = await Promise.all(
    reviews.map(async (r) => ({
      id: r._id.toString(),
      _id: r._id.toString(),
      name: r.name,
      subtitle: r.subtitle || '',
      review: r.review,
      rating: r.rating,
      profileImage: await resolveProfileImageUrl(r.profileImage || ''),
      displayOrder: r.displayOrder ?? 0,
      isActive: r.isActive ?? true,
      courseId: r.courseId || 'unani',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  );

  return {
    reviews: formattedReviews,
    total,
    page: parsedPage,
    limit: parsedLimit,
  };
}

/**
 * Get a single Unani Review by ID
 */
async function getReviewById(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const review = await UnaniReview.findOne({
    _id: id,
    courseId: 'unani',
    isDeleted: { $ne: true },
  }).lean();

  if (!review) return null;

  return {
    id: review._id.toString(),
    _id: review._id.toString(),
    name: review.name,
    subtitle: review.subtitle || '',
    review: review.review,
    rating: review.rating,
    profileImage: await resolveProfileImageUrl(review.profileImage || ''),
    displayOrder: review.displayOrder ?? 0,
    isActive: review.isActive ?? true,
    courseId: review.courseId || 'unani',
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/**
 * Update an existing Unani Review
 */
async function updateReview(id, payload = {}) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const updateFields = {};

  if (payload.name !== undefined) updateFields.name = String(payload.name).trim();
  if (payload.subtitle !== undefined) updateFields.subtitle = String(payload.subtitle).trim();
  if (payload.review !== undefined) updateFields.review = String(payload.review).trim();
  if (payload.rating !== undefined && payload.rating !== null && payload.rating !== '') {
    updateFields.rating = Number(payload.rating);
  }
  if (payload.profileImage !== undefined) {
    updateFields.profileImage = String(payload.profileImage).trim();
  }
  if (payload.displayOrder !== undefined && payload.displayOrder !== null) {
    updateFields.displayOrder = Number(payload.displayOrder);
  }
  if (payload.isActive !== undefined) {
    updateFields.isActive = Boolean(payload.isActive === true || payload.isActive === 'true');
  }

  const updated = await UnaniReview.findOneAndUpdate(
    { _id: id, courseId: 'unani', isDeleted: { $ne: true } },
    { $set: updateFields },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) return null;

  return {
    id: updated._id.toString(),
    _id: updated._id.toString(),
    name: updated.name,
    subtitle: updated.subtitle || '',
    review: updated.review,
    rating: updated.rating,
    profileImage: await resolveProfileImageUrl(updated.profileImage || ''),
    displayOrder: updated.displayOrder ?? 0,
    isActive: updated.isActive ?? true,
    courseId: updated.courseId || 'unani',
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Toggle or update status of Unani Review
 */
async function updateReviewStatus(id, isActive) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const updated = await UnaniReview.findOneAndUpdate(
    { _id: id, courseId: 'unani', isDeleted: { $ne: true } },
    { $set: { isActive: Boolean(isActive === true || isActive === 'true') } },
    { new: true }
  ).lean();

  if (!updated) return null;

  return {
    id: updated._id.toString(),
    _id: updated._id.toString(),
    name: updated.name,
    isActive: updated.isActive,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Delete a Unani Review
 */
async function deleteReview(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const deleted = await UnaniReview.findOneAndDelete({
    _id: id,
    courseId: 'unani',
  }).lean();

  if (!deleted) return null;

  return {
    id: deleted._id.toString(),
    _id: deleted._id.toString(),
    name: deleted.name,
  };
}

/**
 * Public & Student fetch for active Unani Reviews
 * Completely read-only, no authentication required, filtered to active only, ordered by displayOrder ASC
 */
async function getPublicReviews() {
  const reviews = await UnaniReview.find({
    courseId: 'unani',
    isActive: true,
    isDeleted: { $ne: true },
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  return await Promise.all(
    reviews.map(async (r) => ({
      id: r._id.toString(),
      _id: r._id.toString(),
      name: r.name,
      subtitle: r.subtitle || '',
      review: r.review,
      rating: r.rating,
      profileImage: await resolveProfileImageUrl(r.profileImage || ''),
      displayOrder: r.displayOrder ?? 0,
      isActive: r.isActive ?? true,
      courseId: 'unani',
      createdAt: r.createdAt,
    }))
  );
}

module.exports = {
  createReview,
  getAdminReviews,
  getReviewById,
  updateReview,
  updateReviewStatus,
  deleteReview,
  getPublicReviews,
};
