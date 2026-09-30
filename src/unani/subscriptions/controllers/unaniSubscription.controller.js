const unaniSubscriptionService = require('../services/unaniSubscription.service');
const {
  isValidObjectId,
  validateUnaniSubscriptionCreate,
  validateUnaniSubscriptionUpdate,
} = require('../validators/unaniSubscription.validator');

/**
 * GET /api/admin/unani/subscriptions
 * Admin lists all subscriptions with filtering, search, pagination
 */
async function listAdminSubscriptions(req, res) {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      isActive,
      status,
      sort = 'displayOrder',
      order = 'asc',
    } = req.query;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({
        success: false,
        message: 'page must be >= 1 and limit must be an integer between 1 and 100.',
      });
    }

    const result = await unaniSubscriptionService.listAdminSubscriptions({
      page: parsedPage,
      limit: parsedLimit,
      search,
      isActive,
      status,
      sort,
      order,
    });

    return res.status(200).json({
      success: true,
      message: 'Subscriptions fetched successfully',
      count: result.subscriptions.length,
      data: result.subscriptions,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.error('Error fetching admin subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions.',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/unani/subscriptions/:id
 * Admin views a single subscription
 */
async function getAdminSubscriptionById(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription ID format.',
      });
    }

    const subscription = await unaniSubscriptionService.getAdminSubscriptionById(id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription fetched successfully',
      data: subscription,
    });
  } catch (error) {
    console.error('Error fetching subscription by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription.',
      error: error.message,
    });
  }
}

/**
 * POST /api/admin/unani/subscriptions
 * Admin creates a new subscription
 */
async function createAdminSubscription(req, res) {
  try {
    const validation = validateUnaniSubscriptionCreate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const subscription = await unaniSubscriptionService.createSubscription(req.body);

    return res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: subscription,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create subscription.',
      error: error.message,
    });
  }
}

/**
 * PUT /api/admin/unani/subscriptions/:id
 * Admin updates an existing subscription
 */
async function updateAdminSubscription(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription ID format.',
      });
    }

    const validation = validateUnaniSubscriptionUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const updated = await unaniSubscriptionService.updateSubscription(id, req.body);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription.',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/admin/unani/subscriptions/:id
 * Admin deletes a subscription (with reference check / soft-delete preservation)
 */
async function deleteAdminSubscription(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription ID format.',
      });
    }

    const result = await unaniSubscriptionService.deleteSubscription(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription deleted successfully',
      referenced: result.referencesFound > 0,
      softDeleted: result.softDeleted,
    });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete subscription.',
      error: error.message,
    });
  }
}

/**
 * PATCH /api/admin/unani/subscriptions/:id/status
 * Admin activates / deactivates a subscription
 */
async function updateSubscriptionStatus(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription ID format.',
      });
    }

    const { isActive, status } = req.body;

    if (isActive === undefined && status === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Either isActive (boolean) or status (string) is required.',
      });
    }

    let activeBool;
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean.',
        });
      }
      activeBool = isActive;
    } else {
      const s = String(status).trim();
      if (s !== 'Active' && s !== 'Inactive') {
        return res.status(400).json({
          success: false,
          message: "status must be either 'Active' or 'Inactive'.",
        });
      }
      activeBool = s === 'Active';
    }

    const updated = await unaniSubscriptionService.updateSubscriptionStatus(id, activeBool);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription status updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating subscription status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription status.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani/subscriptions or GET /api/student/unani/subscriptions
 * Student lists only active subscriptions
 */
async function listStudentSubscriptions(req, res) {
  try {
    const subscriptions = await unaniSubscriptionService.listStudentSubscriptions();

    return res.status(200).json({
      success: true,
      message: 'Subscriptions fetched successfully',
      count: subscriptions.length,
      data: subscriptions,
    });
  } catch (error) {
    console.error('Error fetching student subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani/subscriptions/:id or GET /api/student/unani/subscriptions/:id
 * Student views active subscription details
 */
async function getStudentSubscriptionDetails(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription ID format.',
      });
    }

    const subscription = await unaniSubscriptionService.getStudentSubscriptionDetails(id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found or is currently inactive.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription details fetched successfully',
      data: subscription,
    });
  } catch (error) {
    console.error('Error fetching student subscription details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription details.',
      error: error.message,
    });
  }
}

module.exports = {
  listAdminSubscriptions,
  getAdminSubscriptionById,
  createAdminSubscription,
  updateAdminSubscription,
  deleteAdminSubscription,
  updateSubscriptionStatus,
  listStudentSubscriptions,
  getStudentSubscriptionDetails,
};
