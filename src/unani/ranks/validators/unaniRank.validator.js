/**
 * Unani Rank Validator
 * Ensures independent Unani rank inputs are clean, valid, and type-safe.
 */

function validateUnaniRank(data = {}, isUpdate = false) {
  const errors = [];

  if (!isUpdate || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      errors.push('Name is required and must be a non-empty string.');
    }
  }

  if (data.year !== undefined && data.year !== null && data.year !== '') {
    const parsedYear = Number(data.year);
    if (isNaN(parsedYear) || parsedYear < 1950 || parsedYear > 2100) {
      errors.push('Year must be a valid 4-digit number between 1950 and 2100.');
    }
  }

  if (data.score !== undefined && data.score !== null && data.score !== '') {
    const parsedScore = Number(data.score);
    if (isNaN(parsedScore)) {
      errors.push('Score must be a valid number.');
    }
  }

  if (data.percentage !== undefined && data.percentage !== null && data.percentage !== '') {
    const parsedPct = Number(data.percentage);
    if (isNaN(parsedPct) || parsedPct < 0 || parsedPct > 100) {
      errors.push('Percentage must be a number between 0 and 100.');
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
  validateUnaniRank,
};
