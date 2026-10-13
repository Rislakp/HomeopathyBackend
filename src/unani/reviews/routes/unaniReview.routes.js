const express = require('express');
const router = express.Router();
const unaniReviewController = require('../controllers/unaniReview.controller');
const { requireAdmin } = require('../../../../middleware/rbac');

// ===========================================================================
// ADMIN ENDPOINTS — Require Admin/Superadmin role (Bearer token)
// ===========================================================================

/**
 * @route   GET /api/admin/unani/reviews
 * @desc    List all Unani reviews for Admin
 * @access  Private / Admin
 */
router.get('/api/admin/unani/reviews', requireAdmin, unaniReviewController.getAdminReviews);
router.get('/api/v1/admin/unani/reviews', requireAdmin, unaniReviewController.getAdminReviews);

/**
 * @route   POST /api/admin/unani/reviews
 * @desc    Create a new Unani review
 * @access  Private / Admin
 */
router.post('/api/admin/unani/reviews', requireAdmin, unaniReviewController.createAdminReview);
router.post('/api/v1/admin/unani/reviews', requireAdmin, unaniReviewController.createAdminReview);

/**
 * @route   PATCH /api/admin/unani/reviews/:id/status
 * @desc    Toggle or update isActive status of a Unani review
 * @access  Private / Admin
 */
router.patch('/api/admin/unani/reviews/:id/status', requireAdmin, unaniReviewController.updateReviewStatus);
router.patch('/api/v1/admin/unani/reviews/:id/status', requireAdmin, unaniReviewController.updateReviewStatus);

/**
 * @route   GET /api/admin/unani/reviews/:id
 * @desc    Get a single Unani review by ID
 * @access  Private / Admin
 */
router.get('/api/admin/unani/reviews/:id', requireAdmin, unaniReviewController.getAdminReviewById);
router.get('/api/v1/admin/unani/reviews/:id', requireAdmin, unaniReviewController.getAdminReviewById);

/**
 * @route   PUT /api/admin/unani/reviews/:id
 * @desc    Update an existing Unani review
 * @access  Private / Admin
 */
router.put('/api/admin/unani/reviews/:id', requireAdmin, unaniReviewController.updateAdminReview);
router.put('/api/v1/admin/unani/reviews/:id', requireAdmin, unaniReviewController.updateAdminReview);

/**
 * @route   DELETE /api/admin/unani/reviews/:id
 * @desc    Delete a Unani review
 * @access  Private / Admin
 */
router.delete('/api/admin/unani/reviews/:id', requireAdmin, unaniReviewController.deleteAdminReview);
router.delete('/api/v1/admin/unani/reviews/:id', requireAdmin, unaniReviewController.deleteAdminReview);

// ===========================================================================
// PUBLIC / STUDENT ENDPOINTS — Completely public, read-only
// ===========================================================================

/**
 * @route   GET /api/unani/reviews
 * @desc    List active Unani reviews for Public Landing Page and Student Portal
 * @access  Public (No auth required)
 */
router.get('/api/unani/reviews', unaniReviewController.getPublicReviews);
router.get('/api/v1/unani/reviews', unaniReviewController.getPublicReviews);
router.get('/api/student/unani/reviews', unaniReviewController.getPublicReviews);
router.get('/api/v1/student/unani/reviews', unaniReviewController.getPublicReviews);

module.exports = router;
