/**
 * Unani Review Validator
 * Ensures independent Unani review inputs are clean, valid, and type-safe.
 */

function validateUnaniReview(data = {}, isUpdate = false) {
  const errors = [];

  // name: required on create, optional on update
  if (!isUpdate || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      errors.push('Name is required and must be a non-empty string.');
    }
  }

  // review: required on create, optional on update
  if (!isUpdate || data.review !== undefined) {
    if (!data.review || typeof data.review !== 'string' || !data.review.trim()) {
      errors.push('Review text is required and must be a non-empty string.');
    }
  }

  // rating: required on create, validated range on update
  if (!isUpdate || data.rating !== undefined) {
    if (data.rating === undefined || data.rating === null || data.rating === '') {
      if (!isUpdate) {
        errors.push('Rating is required.');
      }
    } else {
      const parsedRating = Number(data.rating);
      if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        errors.push('Rating must be a number between 1 and 5.');
      }
    }
  }

  if (data.displayOrder !== undefined && data.displayOrder !== null && data.displayOrder !== '') {
    const parsedOrder = Number(data.displayOrder);
    if (isNaN(parsedOrder)) {
      errors.push('displayOrder must be a number.');
    }
  }

  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
    if (data.isActive === 'true' || data.isActive === 'false') {
      // Allow string boolean coercions
    } else {
      errors.push('isActive must be a boolean.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateUnaniReview,
};
