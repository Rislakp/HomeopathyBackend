/**
 * Standard Server-Side Pagination Utility
 *
 * Enforces strict limits:
 * - Default: page = 1, limit = 20
 * - Maximum limit = 100 (requests with limit > 100 are rejected with 400)
 * - Minimum page = 1, limit = 1
 */

class PaginationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'PaginationError';
    this.statusCode = statusCode;
  }
}

/**
 * Validates and parses query parameters for pagination.
 * Throws PaginationError if invalid.
 *
 * @param {Object} query - req.query object
 * @param {Object} options - optional custom defaults
 * @param {number} options.defaultLimit - default limit if unspecified (default: 20)
 * @param {number} options.maxLimit - maximum allowed limit (default: 100)
 * @returns {{ page: number, limit: number, skip: number }}
 */
function parsePaginationParams(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 100;

  let rawPage = query.page;
  let rawLimit = query.limit;

  // Handle defaults when not provided
  let page = rawPage !== undefined && rawPage !== null && String(rawPage).trim() !== ''
    ? Number(rawPage)
    : 1;

  let limit = rawLimit !== undefined && rawLimit !== null && String(rawLimit).trim() !== ''
    ? Number(rawLimit)
    : defaultLimit;

  // Strict integer validation
  if (!Number.isInteger(page) || page < 1) {
    throw new PaginationError('Invalid page parameter. Page must be an integer greater than or equal to 1.', 400);
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new PaginationError('Invalid limit parameter. Limit must be an integer greater than or equal to 1.', 400);
  }

  // Never allow requests greater than maxLimit (100)
  if (limit > maxLimit) {
    throw new PaginationError(`Limit exceeds maximum allowed size of ${maxLimit}. Requested: ${limit}.`, 400);
  }

  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
}

/**
 * Builds the standard pagination response metadata object
 *
 * @param {number} total - total document count matching filter
 * @param {number} page - current page
 * @param {number} limit - items per page
 * @returns {Object}
 */
function buildPaginationResponse(total, page, limit) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = limit > 0 ? Math.ceil(safeTotal / limit) : (safeTotal > 0 ? 1 : 0);

  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    // Backwards-compatible aliases for Flutter and legacy clients
    total_pages: totalPages,
    pages: totalPages,
    has_next: hasNextPage,
    has_prev: hasPreviousPage,
    hasPrevPage: hasPreviousPage,
  };
}

module.exports = {
  PaginationError,
  parsePaginationParams,
  buildPaginationResponse,
};
