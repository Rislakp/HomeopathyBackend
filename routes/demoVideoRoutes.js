const express = require('express');
const router = express.Router();
const demoVideoController = require('../controllers/demoVideoController');
const { requireAdmin } = require('../middleware/rbac');

// ==========================================
// DEMO VIDEOS CRUD
// ==========================================

// GET /api/v1/demo-videos - Fetch all demo videos (Public)
router.get('/', demoVideoController.getDemoVideos);

// GET /api/v1/demo-videos/:id - Fetch single demo video by ID (Public)
router.get('/:id', demoVideoController.getDemoVideoById);

// POST /api/v1/demo-videos - Create a new demo video (Admin Only)
router.post('/', requireAdmin, demoVideoController.createDemoVideo);

// PUT /api/v1/demo-videos/:id - Update an existing demo video (Admin Only)
router.put('/:id', requireAdmin, demoVideoController.updateDemoVideo);

// DELETE /api/v1/demo-videos/:id - Delete a demo video (Admin Only)
router.delete('/:id', requireAdmin, demoVideoController.deleteDemoVideo);

module.exports = router;
