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

/**
 * @desc    Get only active subscription plans (for student portal)
 * @route   GET /api/v1/subscriptions/plans
 * @access  Public — no authentication required
 */
exports.getActiveSubscriptionPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ status: 'Active' })
      .sort({ price: 1 })
      .select('title frequency billingSuffix price description isMostPopular status features createdAt');

    return res.status(200).json({
      success: true,
      message: 'Subscription plans fetched successfully',
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error('Error fetching active subscription plans:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans',
      error: error.message,
    });
  }
};

/**
 * @desc    Assign a subscription plan to a student
 * @route   POST /api/v1/subscriptions/assign
 * @access  Public (student portal) or Admin
 */
exports.assignSubscription = async (req, res) => {
  try {
    const { studentId, planId } = req.body;

    // 1. Validate required fields
    if (!studentId || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Both studentId and planId are required',
      });
    }

    const mongoose = require('mongoose');

    // 2. Validate ID formats
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid studentId format',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid planId format',
      });
    }

    // 3. Find the student
    const Student = require('../models/Student');
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    // 4. Find the subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found',
      });
    }

    if (plan.status !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'This subscription plan is currently inactive',
      });
    }

    // 5. Calculate expiry date based on plan frequency
    const now = new Date();
    let expiresAt = null;

    switch (plan.frequency) {
      case 'Monthly':
        expiresAt = new Date(now.setMonth(now.getMonth() + 1));
        break;
      case 'Quarterly':
        expiresAt = new Date(now.setMonth(now.getMonth() + 3));
        break;
      case 'Yearly':
        expiresAt = new Date(now.setFullYear(now.getFullYear() + 1));
        break;
      case 'Lifetime':
        expiresAt = null; // Never expires
        break;
      default:
        expiresAt = new Date(now.setMonth(now.getMonth() + 1));
    }

    // 6. Update student record
    student.subscription = plan.title;
    student.subscriptionPlanId = plan._id;
    student.subscriptionStatus = 'Active';
    student.subscriptionExpiresAt = expiresAt;
    student.status = 'Active';

    await student.save();

    return res.status(200).json({
      success: true,
      message: 'Subscription updated successfully',
      data: {
        studentId: student._id,
        studentName: student.name,
        subscription: student.subscription,
        subscriptionStatus: student.subscriptionStatus,
        subscriptionExpiresAt: student.subscriptionExpiresAt,
        plan: {
          planId: plan._id,
          title: plan.title,
          frequency: plan.frequency,
          price: plan.price,
        },
      },
    });
  } catch (error) {
    console.error('Error assigning subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign subscription',
      error: error.message,
    });
  }
};
