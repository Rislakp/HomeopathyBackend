const express = require('express');
const router = express.Router();
const unaniRankController = require('../controllers/unaniRank.controller');
const { requireAdmin } = require('../../../../middleware/rbac');

// ===========================================================================
// ADMIN ENDPOINTS — Require Admin/Superadmin role (Bearer token)
// ===========================================================================

/**
 * @route   GET /api/admin/unani/ranks
 * @desc    List all Unani rank holders for Admin
 * @access  Private / Admin
 */
router.get('/api/admin/unani/ranks', requireAdmin, unaniRankController.getAdminRanks);
router.get('/api/v1/admin/unani/ranks', requireAdmin, unaniRankController.getAdminRanks);

/**
 * @route   POST /api/admin/unani/ranks
 * @desc    Create a new Unani rank holder
 * @access  Private / Admin
 */
router.post('/api/admin/unani/ranks', requireAdmin, unaniRankController.createAdminRank);
router.post('/api/v1/admin/unani/ranks', requireAdmin, unaniRankController.createAdminRank);

/**
 * @route   PATCH /api/admin/unani/ranks/:id/status
 * @desc    Toggle or update isActive status of an Unani rank holder
 * @access  Private / Admin
 */
router.patch('/api/admin/unani/ranks/:id/status', requireAdmin, unaniRankController.updateRankStatus);
router.patch('/api/v1/admin/unani/ranks/:id/status', requireAdmin, unaniRankController.updateRankStatus);

/**
 * @route   GET /api/admin/unani/ranks/:id
 * @desc    Get a single Unani rank holder by ID
 * @access  Private / Admin
 */
router.get('/api/admin/unani/ranks/:id', requireAdmin, unaniRankController.getAdminRankById);
router.get('/api/v1/admin/unani/ranks/:id', requireAdmin, unaniRankController.getAdminRankById);

/**
 * @route   PUT /api/admin/unani/ranks/:id
 * @desc    Update an existing Unani rank holder
 * @access  Private / Admin
 */
router.put('/api/admin/unani/ranks/:id', requireAdmin, unaniRankController.updateAdminRank);
router.put('/api/v1/admin/unani/ranks/:id', requireAdmin, unaniRankController.updateAdminRank);

/**
 * @route   DELETE /api/admin/unani/ranks/:id
 * @desc    Delete an Unani rank holder
 * @access  Private / Admin
 */
router.delete('/api/admin/unani/ranks/:id', requireAdmin, unaniRankController.deleteAdminRank);
router.delete('/api/v1/admin/unani/ranks/:id', requireAdmin, unaniRankController.deleteAdminRank);

// ===========================================================================
// PUBLIC / STUDENT ENDPOINTS — Completely public, read-only
// ===========================================================================

/**
 * @route   GET /api/unani/ranks
 * @desc    List active Unani rank holders for Public Landing Page and Student Portal
 * @access  Public (No auth required)
 */
router.get('/api/unani/ranks', unaniRankController.getPublicRanks);
router.get('/api/v1/unani/ranks', unaniRankController.getPublicRanks);
router.get('/api/student/unani/ranks', unaniRankController.getPublicRanks);
router.get('/api/v1/student/unani/ranks', unaniRankController.getPublicRanks);

module.exports = router;
