const express = require('express');
const router = express.Router();
const unaniSubscriptionController = require('../controllers/unaniSubscription.controller');
const { requireAdmin, requireAuth } = require('../../../../middleware/rbac');

// ===========================================================================
// ADMIN ENDPOINTS — Require Admin/Superadmin role
// ===========================================================================

/**
 * @route   GET /api/admin/unani/subscriptions
 * @desc    List all Unani subscriptions (with pagination, search, filters)
 * @access  Private / Admin
 */
router.get('/api/admin/unani/subscriptions', requireAdmin, unaniSubscriptionController.listAdminSubscriptions);
router.get('/api/v1/admin/unani/subscriptions', requireAdmin, unaniSubscriptionController.listAdminSubscriptions);

/**
 * IMPORTANT: Register static sub-routes BEFORE /:id to prevent route collisions
 * e.g. GET /subscriptions/status must not be matched by /:id
 */

/**
 * @route   GET /api/admin/unani/subscriptions/:id
 * @desc    Get a single Unani subscription by ID
 * @access  Private / Admin
 */
router.get('/api/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.getAdminSubscriptionById);
router.get('/api/v1/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.getAdminSubscriptionById);

/**
 * @route   POST /api/admin/unani/subscriptions
 * @desc    Create a new Unani subscription
 * @access  Private / Admin
 */
router.post('/api/admin/unani/subscriptions', requireAdmin, unaniSubscriptionController.createAdminSubscription);
router.post('/api/v1/admin/unani/subscriptions', requireAdmin, unaniSubscriptionController.createAdminSubscription);

/**
 * @route   PUT /api/admin/unani/subscriptions/:id
 * @desc    Update an existing Unani subscription
 * @access  Private / Admin
 */
router.put('/api/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.updateAdminSubscription);
router.put('/api/v1/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.updateAdminSubscription);

/**
 * @route   PATCH /api/admin/unani/subscriptions/:id/status
 * @desc    Activate or deactivate a Unani subscription
 * @access  Private / Admin
 */
router.patch('/api/admin/unani/subscriptions/:id/status', requireAdmin, unaniSubscriptionController.updateSubscriptionStatus);
router.patch('/api/v1/admin/unani/subscriptions/:id/status', requireAdmin, unaniSubscriptionController.updateSubscriptionStatus);

/**
 * @route   DELETE /api/admin/unani/subscriptions/:id
 * @desc    Delete a Unani subscription (soft-delete if student references exist)
 * @access  Private / Admin
 */
router.delete('/api/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.deleteAdminSubscription);
router.delete('/api/v1/admin/unani/subscriptions/:id', requireAdmin, unaniSubscriptionController.deleteAdminSubscription);

// ===========================================================================
// STUDENT / PUBLIC ENDPOINTS — Authentication optional (active subs are public)
// ===========================================================================

/**
 * @route   GET /api/unani/subscriptions
 * @route   GET /api/student/unani/subscriptions
 * @desc    List active Unani subscriptions for students (public read)
 * @access  Public (no auth required) — Students only see isActive=true items
 */
router.get('/api/unani/subscriptions', unaniSubscriptionController.listStudentSubscriptions);
router.get('/api/v1/unani/subscriptions', unaniSubscriptionController.listStudentSubscriptions);
router.get('/api/student/unani/subscriptions', unaniSubscriptionController.listStudentSubscriptions);
router.get('/api/v1/student/unani/subscriptions', unaniSubscriptionController.listStudentSubscriptions);

/**
 * @route   GET /api/unani/subscriptions/:id
 * @route   GET /api/student/unani/subscriptions/:id
 * @desc    Get active Unani subscription details for student
 * @access  Public (no auth required) — Returns 404 if inactive or not found
 */
router.get('/api/unani/subscriptions/:id', unaniSubscriptionController.getStudentSubscriptionDetails);
router.get('/api/v1/unani/subscriptions/:id', unaniSubscriptionController.getStudentSubscriptionDetails);
router.get('/api/student/unani/subscriptions/:id', unaniSubscriptionController.getStudentSubscriptionDetails);
router.get('/api/v1/student/unani/subscriptions/:id', unaniSubscriptionController.getStudentSubscriptionDetails);

module.exports = router;
