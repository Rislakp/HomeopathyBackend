const mongoose = require('mongoose');
const UnaniSubscription = require('../models/unaniSubscription.model');
const Student = require('../../../../models/Student');
const User = require('../../../../models/User');

/**
 * Serialize document for student consumption (hides internal deletion/admin fields)
 */
function serializeForStudent(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  return {
    _id: json._id ? json._id.toString() : json.id,
    id: json._id ? json._id.toString() : json.id,
    name: json.name || json.title,
    title: json.title || json.name,
    description: json.description || '',
    price: json.price,
    fee: json.price,
    currency: json.currency || 'INR',
    duration: json.duration,
    durationUnit: json.durationUnit || 'months',
    frequency: json.frequency || (json.duration + ' ' + (json.durationUnit || 'months')),
    billingSuffix: json.billingSuffix || `/${json.durationUnit === 'years' ? 'yr' : 'mo'}`,
    features: Array.isArray(json.features) ? json.features : [],
    courseId: json.courseId || 'unani',
    course: json.course || 'unani',
    courseCategory: json.courseCategory || 'unani',
    image: json.image || '',
    banner: json.banner || '',
    isMostPopular: Boolean(json.isMostPopular || json.isPopular),
    isPopular: Boolean(json.isMostPopular || json.isPopular),
    isActive: Boolean(json.isActive),
    status: json.status || (json.isActive ? 'Active' : 'Inactive'),
    displayOrder: json.displayOrder !== undefined ? json.displayOrder : 0,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}

/**
 * List subscriptions for Admin with pagination, filtering, search, sorting
 */
async function listAdminSubscriptions({
  page = 1,
  limit = 20,
  search = '',
  isActive = undefined,
  status = undefined,
  sort = 'displayOrder',
  order = 'asc',
}) {
  const query = { isDeleted: { $ne: true } };

  if (isActive !== undefined && isActive !== '') {
    query.isActive = typeof isActive === 'boolean' ? isActive : isActive === 'true';
  } else if (status) {
    query.status = status;
  }

  if (search && String(search).trim()) {
    const term = String(search).trim();
    const regex = new RegExp(term, 'i');
    query.$or = [
      { name: regex },
      { title: regex },
      { description: regex },
      { features: regex },
    ];
  }

  const sortOptions = {};
  if (sort === 'displayOrder') {
    sortOptions.displayOrder = order === 'desc' ? -1 : 1;
    sortOptions.createdAt = -1;
  } else if (sort === 'price') {
    sortOptions.price = order === 'desc' ? -1 : 1;
  } else if (sort === 'createdAt') {
    sortOptions.createdAt = order === 'desc' ? -1 : 1;
  } else {
    sortOptions[sort] = order === 'desc' ? -1 : 1;
  }

  const skip = (page - 1) * limit;

  const [subscriptions, total] = await Promise.all([
    UnaniSubscription.find(query).sort(sortOptions).skip(skip).limit(limit),
    UnaniSubscription.countDocuments(query),
  ]);

  return {
    subscriptions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

/**
 * Get single subscription by ID for Admin
 */
async function getAdminSubscriptionById(id) {
  const subscription = await UnaniSubscription.findOne({
    _id: id,
    isDeleted: { $ne: true },
  });
  return subscription;
}

/**
 * Create a new Unani subscription
 */
async function createSubscription(data) {
  const payload = { ...data };

  // Sync title and name
  if (payload.title && !payload.name) payload.name = payload.title;
  if (payload.name && !payload.title) payload.title = payload.name;

  // Sync price and fee
  if (payload.fee !== undefined && payload.price === undefined) payload.price = Number(payload.fee);
  if (payload.price !== undefined) payload.fee = Number(payload.price);

  // Sync isPopular and isMostPopular
  if (payload.isPopular !== undefined && payload.isMostPopular === undefined) {
    payload.isMostPopular = Boolean(payload.isPopular);
  }
  if (payload.isMostPopular !== undefined) {
    payload.isPopular = Boolean(payload.isMostPopular);
  }

  // Sync status and isActive
  if (payload.status !== undefined && payload.isActive === undefined) {
    payload.isActive = payload.status === 'Active';
  } else if (payload.isActive !== undefined) {
    payload.status = payload.isActive ? 'Active' : 'Inactive';
  }

  // Compute default displayOrder if omitted
  if (payload.displayOrder === undefined || payload.displayOrder === null) {
    const highest = await UnaniSubscription.findOne({ isDeleted: { $ne: true } })
      .sort({ displayOrder: -1 })
      .select('displayOrder')
      .lean();
    payload.displayOrder = highest && typeof highest.displayOrder === 'number' ? highest.displayOrder + 1 : 1;
  } else {
    payload.displayOrder = Number(payload.displayOrder);
  }

  // Ensure default duration and unit
  if (!payload.duration) payload.duration = 12;
  if (!payload.durationUnit) payload.durationUnit = 'months';

  // Ensure course is unani
  payload.courseId = 'unani';
  payload.course = 'unani';
  payload.courseCategory = 'unani';

  const newSub = await UnaniSubscription.create(payload);
  return newSub;
}

/**
 * Update an existing subscription
 */
async function updateSubscription(id, data) {
  const sub = await UnaniSubscription.findOne({
    _id: id,
    isDeleted: { $ne: true },
  });

  if (!sub) return null;

  const allowedFields = [
    'name',
    'title',
    'description',
    'price',
    'fee',
    'currency',
    'duration',
    'durationUnit',
    'frequency',
    'billingSuffix',
    'features',
    'image',
    'banner',
    'isMostPopular',
    'isPopular',
    'isActive',
    'status',
    'displayOrder',
  ];

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      sub[field] = data[field];
    }
  });

  // Cross-synchronize alias fields
  if (data.name !== undefined && data.title === undefined) sub.title = data.name;
  if (data.title !== undefined && data.name === undefined) sub.name = data.title;
  if (data.price !== undefined) sub.fee = Number(data.price);
  if (data.fee !== undefined && data.price === undefined) sub.price = Number(data.fee);
  if (data.isMostPopular !== undefined) sub.isPopular = Boolean(data.isMostPopular);
  if (data.isPopular !== undefined && data.isMostPopular === undefined) sub.isMostPopular = Boolean(data.isPopular);

  if (data.isActive !== undefined) {
    sub.status = data.isActive ? 'Active' : 'Inactive';
  } else if (data.status !== undefined) {
    sub.isActive = data.status === 'Active';
  }

  if (data.displayOrder !== undefined) {
    sub.displayOrder = Number(data.displayOrder);
  }

  await sub.save();
  return sub;
}

/**
 * Update active/inactive status
 */
async function updateSubscriptionStatus(id, isActive) {
  const sub = await UnaniSubscription.findOne({
    _id: id,
    isDeleted: { $ne: true },
  });

  if (!sub) return null;

  sub.isActive = Boolean(isActive);
  sub.status = sub.isActive ? 'Active' : 'Inactive';

  await sub.save();
  return sub;
}

/**
 * Delete a subscription with safety check for references
 */
async function deleteSubscription(id) {
  const sub = await UnaniSubscription.findOne({
    _id: id,
    isDeleted: { $ne: true },
  });

  if (!sub) return null;

  // Check if students reference this subscription
  const studentRefCount = await Student.countDocuments({
    $or: [
      { subscriptionPlanId: sub._id },
      { unaniSubscriptionId: sub._id },
      { subscription: sub.name },
      { subscription: sub.title },
      { 'subscriptions.planId': sub._id },
      { 'subscriptions.subscriptionId': sub._id },
    ],
  });

  if (studentRefCount > 0) {
    // Preserve historical integrity: soft delete
    sub.isDeleted = true;
    sub.isActive = false;
    sub.status = 'Inactive';
    sub.deletedAt = new Date();
    await sub.save();
    return {
      deleted: true,
      softDeleted: true,
      referencesFound: studentRefCount,
      subscription: sub,
    };
  }

  // If no external student references exist, safely delete the document
  await UnaniSubscription.findByIdAndDelete(id);
  return {
    deleted: true,
    softDeleted: false,
    referencesFound: 0,
    subscription: sub,
  };
}

/**
 * List active subscriptions for Students
 */
async function listStudentSubscriptions() {
  const subscriptions = await UnaniSubscription.find({
    isActive: true,
    isDeleted: { $ne: true },
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  return subscriptions.map(serializeForStudent);
}

/**
 * Get active subscription details for Student
 */
async function getStudentSubscriptionDetails(id) {
  const subscription = await UnaniSubscription.findOne({
    _id: id,
    isActive: true,
    isDeleted: { $ne: true },
  });

  if (!subscription) return null;
  return serializeForStudent(subscription);
}

module.exports = {
  listAdminSubscriptions,
  getAdminSubscriptionById,
  createSubscription,
  updateSubscription,
  updateSubscriptionStatus,
  deleteSubscription,
  listStudentSubscriptions,
  getStudentSubscriptionDetails,
  serializeForStudent,
};
