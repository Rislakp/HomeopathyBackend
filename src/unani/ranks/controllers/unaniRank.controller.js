const unaniRankService = require('../services/unaniRank.service');
const { validateUnaniRank } = require('../validators/unaniRank.validator');

/**
 * POST /api/admin/unani/ranks
 * Create a new Unani Rank (Admin only)
 */
async function createAdminRank(req, res) {
  try {
    const validation = validateUnaniRank(req.body, false);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const rank = await unaniRankService.createRank(req.body);
    return res.status(201).json({
      success: true,
      message: 'Unani rank created successfully',
      data: rank,
    });
  } catch (error) {
    console.error('Error creating Unani rank:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create Unani rank',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/unani/ranks
 * List all Unani Ranks (Admin only)
 */
async function getAdminRanks(req, res) {
  try {
    const { page = 1, limit = 50, search = '', isActive } = req.query;
    const result = await unaniRankService.getAdminRanks({
      page,
      limit,
      search,
      isActive,
    });

    return res.status(200).json({
      success: true,
      count: result.ranks.length,
      data: result.ranks,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('Error fetching admin Unani ranks:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani ranks',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/unani/ranks/:id
 * Get single Unani Rank by ID (Admin only)
 */
async function getAdminRankById(req, res) {
  try {
    const rank = await unaniRankService.getRankById(req.params.id);
    if (!rank) {
      return res.status(404).json({
        success: false,
        message: 'Unani rank not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: rank,
    });
  } catch (error) {
    console.error('Error fetching Unani rank by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani rank details',
      error: error.message,
    });
  }
}

/**
 * PUT /api/admin/unani/ranks/:id
 * Update an existing Unani Rank (Admin only)
 */
async function updateAdminRank(req, res) {
  try {
    const validation = validateUnaniRank(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const updated = await unaniRankService.updateRank(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Unani rank not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani rank updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating Unani rank:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani rank',
      error: error.message,
    });
  }
}

/**
 * PATCH /api/admin/unani/ranks/:id/status
 * Toggle or update isActive status (Admin only)
 */
async function updateRankStatus(req, res) {
  try {
    let isActive = req.body && req.body.isActive !== undefined ? req.body.isActive : req.query.isActive;
    if (isActive === undefined) {
      // Toggle if not provided
      const current = await unaniRankService.getRankById(req.params.id);
      if (!current) {
        return res.status(404).json({
          success: false,
          message: 'Unani rank not found',
        });
      }
      isActive = !current.isActive;
    }

    const result = await unaniRankService.updateRankStatus(req.params.id, isActive);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Unani rank not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Unani rank ${result.isActive ? 'activated' : 'deactivated'} successfully`,
      data: result,
    });
  } catch (error) {
    console.error('Error updating Unani rank status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani rank status',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/admin/unani/ranks/:id
 * Delete Unani Rank (Admin only)
 */
async function deleteAdminRank(req, res) {
  try {
    const deleted = await unaniRankService.deleteRank(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Unani rank not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani rank deleted successfully',
      data: deleted,
    });
  } catch (error) {
    console.error('Error deleting Unani rank:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Unani rank',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani/ranks
 * List active Unani ranks for Public Website & Student Portal
 * Read-only, no authentication required, filtered to active only
 */
async function getPublicRanks(req, res) {
  try {
    const ranks = await unaniRankService.getPublicRanks();
    return res.status(200).json({
      success: true,
      count: ranks.length,
      data: ranks,
    });
  } catch (error) {
    console.error('Error fetching public Unani ranks:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani rank holders',
      error: error.message,
    });
  }
}

module.exports = {
  createAdminRank,
  getAdminRanks,
  getAdminRankById,
  updateAdminRank,
  updateRankStatus,
  deleteAdminRank,
  getPublicRanks,
};
