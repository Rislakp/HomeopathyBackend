const mongoose = require('mongoose');

const VALID_DURATION_UNITS = ['days', 'weeks', 'months', 'years'];

/**
 * Validates MongoDB ObjectId
 */
function isValidObjectId(id) {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
}

/**
 * Validates create subscription payload
 */
function validateUnaniSubscriptionCreate(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'] };
  }

  // Name / Title
  const nameVal = data.name !== undefined ? data.name : data.title;
  if (!nameVal || typeof nameVal !== 'string' || !nameVal.trim()) {
    errors.push('Subscription name is required and must be a non-empty string.');
  }

  // Price / Fee
  const priceVal = data.price !== undefined ? data.price : data.fee;
  if (priceVal === undefined || priceVal === null || priceVal === '') {
    errors.push('Subscription price is required.');
  } else if (isNaN(Number(priceVal)) || Number(priceVal) < 0) {
    errors.push('Subscription price must be a valid non-negative number.');
  }

  // Duration
  if (data.duration === undefined || data.duration === null || data.duration === '') {
    errors.push('Subscription duration is required.');
  } else if (isNaN(Number(data.duration)) || Number(data.duration) < 1 || !Number.isInteger(Number(data.duration))) {
    errors.push('Subscription duration must be an integer greater than or equal to 1.');
  }

  // Duration Unit
  if (data.durationUnit !== undefined && data.durationUnit !== null) {
    const unit = String(data.durationUnit).trim().toLowerCase();
    if (!VALID_DURATION_UNITS.includes(unit)) {
      errors.push(`Invalid durationUnit '${data.durationUnit}'. Allowed values: ${VALID_DURATION_UNITS.join(', ')}.`);
    }
  }

  // Features
  if (data.features !== undefined && data.features !== null) {
    if (!Array.isArray(data.features)) {
      errors.push('Features must be an array of strings.');
    } else {
      const allStrings = data.features.every((f) => typeof f === 'string');
      if (!allStrings) {
        errors.push('All items in features array must be strings.');
      }
    }
  }

  // Display Order
  if (data.displayOrder !== undefined && data.displayOrder !== null && data.displayOrder !== '') {
    if (isNaN(Number(data.displayOrder)) || Number(data.displayOrder) < 0) {
      errors.push('displayOrder must be a non-negative number.');
    }
  }

  // isActive / status
  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
    errors.push('isActive must be a boolean (true or false).');
  }
  if (data.status !== undefined) {
    const s = String(data.status).trim();
    if (s !== 'Active' && s !== 'Inactive') {
      errors.push("status must be either 'Active' or 'Inactive'.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates update subscription payload
 */
function validateUnaniSubscriptionUpdate(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Request body must be a valid JSON object.'] };
  }

  // Name / Title
  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || !data.name.trim()) {
      errors.push('Subscription name must be a non-empty string.');
    }
  }
  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim()) {
      errors.push('Subscription title must be a non-empty string.');
    }
  }

  // Price / Fee
  if (data.price !== undefined) {
    if (data.price === null || isNaN(Number(data.price)) || Number(data.price) < 0) {
      errors.push('Subscription price must be a valid non-negative number.');
    }
  }
  if (data.fee !== undefined) {
    if (data.fee === null || isNaN(Number(data.fee)) || Number(data.fee) < 0) {
      errors.push('Subscription fee must be a valid non-negative number.');
    }
  }

  // Duration
  if (data.duration !== undefined) {
    if (data.duration === null || isNaN(Number(data.duration)) || Number(data.duration) < 1 || !Number.isInteger(Number(data.duration))) {
      errors.push('Subscription duration must be an integer greater than or equal to 1.');
    }
  }

  // Duration Unit
  if (data.durationUnit !== undefined && data.durationUnit !== null) {
    const unit = String(data.durationUnit).trim().toLowerCase();
    if (!VALID_DURATION_UNITS.includes(unit)) {
      errors.push(`Invalid durationUnit '${data.durationUnit}'. Allowed values: ${VALID_DURATION_UNITS.join(', ')}.`);
    }
  }

  // Features
  if (data.features !== undefined && data.features !== null) {
    if (!Array.isArray(data.features)) {
      errors.push('Features must be an array of strings.');
    } else {
      const allStrings = data.features.every((f) => typeof f === 'string');
      if (!allStrings) {
        errors.push('All items in features array must be strings.');
      }
    }
  }

  // Display Order
  if (data.displayOrder !== undefined && data.displayOrder !== null && data.displayOrder !== '') {
    if (isNaN(Number(data.displayOrder)) || Number(data.displayOrder) < 0) {
      errors.push('displayOrder must be a non-negative number.');
    }
  }

  // isActive / status
  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
    errors.push('isActive must be a boolean (true or false).');
  }
  if (data.status !== undefined) {
    const s = String(data.status).trim();
    if (s !== 'Active' && s !== 'Inactive') {
      errors.push("status must be either 'Active' or 'Inactive'.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  isValidObjectId,
  validateUnaniSubscriptionCreate,
  validateUnaniSubscriptionUpdate,
};
