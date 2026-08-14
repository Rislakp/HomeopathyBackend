const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById,
} = require('../controllers/exam.controller');
const { requireAdmin } = require('../middleware/rbac');

// Configure multer to store uploaded files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Admin Route: Extract MCQs from PDF
router.post('/api/exams/extract-mcqs', requireAdmin, upload.single('pdf'), extractMCQs);

// Admin Route: Save verified exam document
router.post('/api/exams/grand-mock', requireAdmin, createGrandMockExam);

// Endpoint to get all Grand Mock exams (Summary list)
router.get('/api/exams/grand-mock', getAllGrandMocks);

// Endpoint to get single Grand Mock exam details
router.get('/api/exams/grand-mock/:id', getGrandMockById);

module.exports = router;
