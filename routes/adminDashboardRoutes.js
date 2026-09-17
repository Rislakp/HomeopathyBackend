const express = require('express');
const router = express.Router();
const { getDashboardStats, getRecentActivities } = require('../controllers/adminDashboardController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');
const { requireAdmin } = require('../middleware/rbac');

// Combined admin auth middleware (tries adminAuthMiddleware, falls back to requireAdmin)
const protectAdmin = (req, res, next) => {
  adminAuthMiddleware(req, res, (err) => {
    if (err || res.headersSent) return;
    if (req.admin || req.user) return next();
    return requireAdmin(req, res, next);
  });
};

/**
 * @route   GET /api/admin/dashboard-stats
 * @route   GET /api/v1/admin/dashboard-stats
 * @desc    Fetch aggregated metrics & growth trends for admin dashboard
 * @access  Private (Admin / Superadmin)
 */
router.get('/', protectAdmin, getDashboardStats);
router.get('/dashboard-stats', protectAdmin, getDashboardStats);

/**
 * @route   GET /api/admin/activities
 * @route   GET /api/v1/admin/activities
 * @desc    Fetch recent platform activities feed
 * @access  Private (Admin / Superadmin)
 */
router.get('/activities', protectAdmin, getRecentActivities);

module.exports = router;
