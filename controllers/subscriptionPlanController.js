const SubscriptionPlan = require('../models/SubscriptionPlan');

/**
 * @desc    Create a new subscription plan
 * @route   POST /api/subscriptions
 * @access  Admin
 */
exports.createSubscriptionPlan = async (req, res) => {
  try {
    const { title, frequency, billingSuffix, price, description, isMostPopular, status, features } = req.body;

    // Validate required fields
    if (!title || !frequency || !billingSuffix || price === undefined || !description) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: title, frequency, billingSuffix, price, and description',
      });
    }

    const newPlan = new SubscriptionPlan({
      title,
      frequency,
      billingSuffix,
      price: Number(price),
      description,
      isMostPopular: isMostPopular || false,
      status: status || 'Active',
      features: Array.isArray(features) ? features : [],
    });

    const savedPlan = await newPlan.save();

    return res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully',
      data: savedPlan,
    });
  } catch (error) {
    console.error('Error creating subscription plan:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create subscription plan',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all subscription plans
 * @route   GET /api/subscriptions
 * @access  Public
 */
exports.getSubscriptionPlans = async (req, res) => {
  try {
    const { status, frequency } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }
    
    if (frequency) {
      query.frequency = frequency;
    }

    const plans = await SubscriptionPlan.find(query).sort({ price: 1 });

    return res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single subscription plan by ID
 * @route   GET /api/subscriptions/:id
 * @access  Public
 */
exports.getSubscriptionPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await SubscriptionPlan.findById(id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error('Error fetching subscription plan by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plan',
      error: error.message,
    });
  }
};

/**
 * @desc    Update subscription plan
 * @route   PUT /api/subscriptions/:id
 * @access  Admin
 */
exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedPlan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully',
      data: updatedPlan,
    });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete subscription plan
 * @route   DELETE /api/subscriptions/:id
 * @access  Admin
 */
exports.deleteSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPlan = await SubscriptionPlan.findByIdAndDelete(id);

    if (!deletedPlan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription plan deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete subscription plan',
      error: error.message,
    });
  }
};
