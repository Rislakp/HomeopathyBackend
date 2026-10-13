const unaniReviewService = require('../services/unaniReview.service');
const { validateUnaniReview } = require('../validators/unaniReview.validator');

/**
 * POST /api/admin/unani/reviews
 * Create a new Unani Review (Admin only)
 */
async function createAdminReview(req, res) {
  try {
    const validation = validateUnaniReview(req.body, false);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const review = await unaniReviewService.createReview(req.body);
    return res.status(201).json({
      success: true,
      message: 'Unani review created successfully',
      data: review,
    });
  } catch (error) {
    console.error('Error creating Unani review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create Unani review',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/unani/reviews
 * List all Unani Reviews (Admin only)
 */
async function getAdminReviews(req, res) {
  try {
    const { page = 1, limit = 20, search = '', isActive, sort } = req.query;
    const result = await unaniReviewService.getAdminReviews({
      page,
      limit,
      search,
      isActive,
      sort,
    });

    return res.status(200).json({
      success: true,
      count: result.reviews.length,
      data: result.reviews,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('Error fetching admin Unani reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani reviews',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/unani/reviews/:id
 * Get single Unani Review by ID (Admin only)
 */
async function getAdminReviewById(req, res) {
  try {
    const review = await unaniReviewService.getReviewById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Unani review not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: review,
    });
  } catch (error) {
    console.error('Error fetching Unani review by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani review details',
      error: error.message,
    });
  }
}

/**
 * PUT /api/admin/unani/reviews/:id
 * Update an existing Unani Review (Admin only)
 */
async function updateAdminReview(req, res) {
  try {
    const validation = validateUnaniReview(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const updated = await unaniReviewService.updateReview(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Unani review not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani review updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating Unani review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani review',
      error: error.message,
    });
  }
}

/**
 * PATCH /api/admin/unani/reviews/:id/status
 * Toggle or update isActive status (Admin only)
 */
async function updateReviewStatus(req, res) {
  try {
    let isActive = req.body && req.body.isActive !== undefined ? req.body.isActive : req.query.isActive;
    if (isActive === undefined) {
      // Toggle if not provided
      const current = await unaniReviewService.getReviewById(req.params.id);
      if (!current) {
        return res.status(404).json({
          success: false,
          message: 'Unani review not found',
        });
      }
      isActive = !current.isActive;
    }

    const result = await unaniReviewService.updateReviewStatus(req.params.id, isActive);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Unani review not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Unani review ${result.isActive ? 'activated' : 'deactivated'} successfully`,
      data: result,
    });
  } catch (error) {
    console.error('Error updating Unani review status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani review status',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/admin/unani/reviews/:id
 * Delete Unani Review (Admin only)
 */
async function deleteAdminReview(req, res) {
  try {
    const deleted = await unaniReviewService.deleteReview(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Unani review not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani review deleted successfully',
      data: deleted,
    });
  } catch (error) {
    console.error('Error deleting Unani review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Unani review',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani/reviews
 * List active Unani reviews for Public Website & Student Portal
 * Read-only, no authentication required, filtered to active only
 */
async function getPublicReviews(req, res) {
  try {
    const reviews = await unaniReviewService.getPublicReviews();
    return res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    console.error('Error fetching public Unani reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani reviews',
      error: error.message,
    });
  }
}

module.exports = {
  createAdminReview,
  getAdminReviews,
  getAdminReviewById,
  updateAdminReview,
  updateReviewStatus,
  deleteAdminReview,
  getPublicReviews,
};
