const mongoose = require('mongoose');
const UnaniRank = require('../models/unaniRank.model');
const { resolveProfileImageUrl } = require('../../../../utils/s3MediaSigner');

/**
 * Create a new Unani Rank Holder (Admin only)
 * Completely independent of exams.
 */
async function createRank(payload = {}) {
  const rankData = {
    name: payload.name ? payload.name.trim() : '',
    examName: payload.examName ? payload.examName.trim() : '',
    rankLabel: payload.rankLabel ? payload.rankLabel.trim() : '',
    year: payload.year !== undefined && payload.year !== null && payload.year !== '' ? Number(payload.year) : new Date().getFullYear(),
    category: payload.category ? payload.category.trim() : '',
    score: payload.score !== undefined && payload.score !== null && payload.score !== '' ? Number(payload.score) : null,
    percentage: payload.percentage !== undefined && payload.percentage !== null && payload.percentage !== '' ? Number(payload.percentage) : null,
    profileImage: payload.profileImage ? payload.profileImage.trim() : (payload.imageUrl ? payload.imageUrl.trim() : ''),
    description: payload.description ? payload.description.trim() : '',
    displayOrder: payload.displayOrder !== undefined && payload.displayOrder !== null ? Number(payload.displayOrder) : 0,
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive === true || payload.isActive === 'true') : true,
    courseId: 'unani',
    isDeleted: false,
  };

  const newRank = new UnaniRank(rankData);
  await newRank.save();
  const obj = newRank.toObject({ virtuals: true });
  obj.profileImage = await resolveProfileImageUrl(obj.profileImage);
  return obj;
}

/**
 * List all Unani Ranks for Admin (Supports pagination, search, status filter)
 */
async function getAdminRanks({ page = 1, limit = 50, search = '', isActive } = {}) {
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
      { examName: sRegex },
      { rankLabel: sRegex },
      { category: sRegex },
      { description: sRegex },
    ];
  }

  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = (parsedPage - 1) * parsedLimit;

  const [ranks, total] = await Promise.all([
    UnaniRank.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    UnaniRank.countDocuments(filter),
  ]);

  const formattedRanks = await Promise.all(
    ranks.map(async (r) => ({
      id: r._id.toString(),
      _id: r._id.toString(),
      name: r.name,
      examName: r.examName || '',
      rankLabel: r.rankLabel || '',
      year: r.year,
      category: r.category || '',
      score: r.score,
      percentage: r.percentage,
      profileImage: await resolveProfileImageUrl(r.profileImage || ''),
      description: r.description || '',
      displayOrder: r.displayOrder ?? 0,
      isActive: r.isActive ?? true,
      courseId: r.courseId || 'unani',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  );

  return {
    ranks: formattedRanks,
    total,
    page: parsedPage,
    limit: parsedLimit,
  };
}

/**
 * Get a single Unani Rank by ID
 */
async function getRankById(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const rank = await UnaniRank.findOne({
    _id: id,
    courseId: 'unani',
    isDeleted: { $ne: true },
  }).lean();

  if (!rank) return null;

  return {
    id: rank._id.toString(),
    _id: rank._id.toString(),
    name: rank.name,
    examName: rank.examName || '',
    rankLabel: rank.rankLabel || '',
    year: rank.year,
    category: rank.category || '',
    score: rank.score,
    percentage: rank.percentage,
    profileImage: await resolveProfileImageUrl(rank.profileImage || ''),
    description: rank.description || '',
    displayOrder: rank.displayOrder ?? 0,
    isActive: rank.isActive ?? true,
    courseId: rank.courseId || 'unani',
    createdAt: rank.createdAt,
    updatedAt: rank.updatedAt,
  };
}

/**
 * Update an existing Unani Rank
 */
async function updateRank(id, payload = {}) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const updateFields = {};

  if (payload.name !== undefined) updateFields.name = String(payload.name).trim();
  if (payload.examName !== undefined) updateFields.examName = String(payload.examName).trim();
  if (payload.rankLabel !== undefined) updateFields.rankLabel = String(payload.rankLabel).trim();
  if (payload.year !== undefined && payload.year !== null && payload.year !== '') {
    updateFields.year = Number(payload.year);
  }
  if (payload.category !== undefined) updateFields.category = String(payload.category).trim();
  if (payload.score !== undefined) {
    updateFields.score = payload.score !== null && payload.score !== '' ? Number(payload.score) : null;
  }
  if (payload.percentage !== undefined) {
    updateFields.percentage = payload.percentage !== null && payload.percentage !== '' ? Number(payload.percentage) : null;
  }
  if (payload.profileImage !== undefined) {
    updateFields.profileImage = String(payload.profileImage).trim();
  } else if (payload.imageUrl !== undefined) {
    updateFields.profileImage = String(payload.imageUrl).trim();
  }
  if (payload.description !== undefined) updateFields.description = String(payload.description).trim();
  if (payload.displayOrder !== undefined && payload.displayOrder !== null) {
    updateFields.displayOrder = Number(payload.displayOrder);
  }
  if (payload.isActive !== undefined) {
    updateFields.isActive = Boolean(payload.isActive === true || payload.isActive === 'true');
  }

  const updated = await UnaniRank.findOneAndUpdate(
    { _id: id, courseId: 'unani', isDeleted: { $ne: true } },
    { $set: updateFields },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) return null;

  return {
    id: updated._id.toString(),
    _id: updated._id.toString(),
    name: updated.name,
    examName: updated.examName || '',
    rankLabel: updated.rankLabel || '',
    year: updated.year,
    category: updated.category || '',
    score: updated.score,
    percentage: updated.percentage,
    profileImage: await resolveProfileImageUrl(updated.profileImage || ''),
    description: updated.description || '',
    displayOrder: updated.displayOrder ?? 0,
    isActive: updated.isActive ?? true,
    courseId: updated.courseId || 'unani',
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Toggle or update status of Unani Rank
 */
async function updateRankStatus(id, isActive) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const updated = await UnaniRank.findOneAndUpdate(
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
 * Delete an Unani Rank
 */
async function deleteRank(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const deleted = await UnaniRank.findOneAndDelete({
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
 * Public & Student fetch for active Unani Rank Holders
 * Completely read-only, no authentication required, filtered to active only, ordered by displayOrder ASC
 */
async function getPublicRanks() {
  const ranks = await UnaniRank.find({
    courseId: 'unani',
    isActive: true,
    isDeleted: { $ne: true },
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  return await Promise.all(
    ranks.map(async (r) => ({
      id: r._id.toString(),
      _id: r._id.toString(),
      name: r.name,
      examName: r.examName || '',
      rankLabel: r.rankLabel || '',
      year: r.year,
      category: r.category || '',
      score: r.score,
      percentage: r.percentage,
      profileImage: await resolveProfileImageUrl(r.profileImage || ''),
      description: r.description || '',
      displayOrder: r.displayOrder ?? 0,
      isActive: r.isActive ?? true,
      courseId: 'unani',
      createdAt: r.createdAt,
    }))
  );
}

module.exports = {
  createRank,
  getAdminRanks,
  getRankById,
  updateRank,
  updateRankStatus,
  deleteRank,
  getPublicRanks,
};
