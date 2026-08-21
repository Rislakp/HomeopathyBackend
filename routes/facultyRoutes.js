const express = require('express');
const router = express.Router();
const {
  createFaculty,
  getAllFaculty,
  getFacultyById,
  updateFaculty,
  deleteFaculty,
} = require('../controllers/facultyController');
const { requireAdmin } = require('../middleware/rbac');

// Protect all faculty endpoints with requireAdmin middleware
router.use(requireAdmin);

// Faculty CRUD endpoints
router.post('/', createFaculty);
router.get('/', getAllFaculty);
router.get('/:id', getFacultyById);
router.put('/:id', updateFaculty);
router.patch('/:id', updateFaculty);
router.delete('/:id', deleteFaculty);

module.exports = router;
