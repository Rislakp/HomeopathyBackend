const express = require('express');
const router = express.Router();
const subscriptionPlanController = require('../controllers/subscriptionPlanController');
const { requireAdmin } = require('../middleware/rbac');

// ==========================================
// SUBSCRIPTION PLANS CRUD
// ==========================================

// GET /api/subscriptions/plans - Fetch active plans for student portal (Public, no auth)
router.get('/plans', subscriptionPlanController.getActiveSubscriptionPlans);

// POST /api/subscriptions/assign - Assign a plan to a student (Public, student portal)
router.post('/assign', subscriptionPlanController.assignSubscription);

// GET /api/subscriptions - Fetch all subscription plans (Public)
router.get('/', subscriptionPlanController.getSubscriptionPlans);

// GET /api/subscriptions/:id - Fetch single subscription plan (Public)
router.get('/:id', subscriptionPlanController.getSubscriptionPlanById);

// POST /api/subscriptions - Create a new subscription plan (Admin Only)
router.post('/', requireAdmin, subscriptionPlanController.createSubscriptionPlan);

// PUT /api/subscriptions/:id - Update subscription plan (Admin Only)
router.put('/:id', requireAdmin, subscriptionPlanController.updateSubscriptionPlan);

// DELETE /api/subscriptions/:id - Delete subscription plan (Admin Only)
router.delete('/:id', requireAdmin, subscriptionPlanController.deleteSubscriptionPlan);

module.exports = router;
