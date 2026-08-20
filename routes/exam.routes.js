const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById,
  updateGrandMockExam,
  deleteGrandMockExam,
  deleteExam,
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
router.post('/api/exams', requireAdmin, createGrandMockExam);

// Endpoint to get all Grand Mock exams (Summary list)
router.get('/api/exams/grand-mock', getAllGrandMocks);
router.get('/api/exams', getAllGrandMocks);

// Endpoint to get single Grand Mock exam details
router.get('/api/exams/grand-mock/:id', getGrandMockById);
router.get('/api/exams/:id', getGrandMockById);

// Admin Route: Update Grand Mock Exam
router.put('/api/exams/grand-mock/:id', updateGrandMockExam);
router.put('/api/exams/:id', updateGrandMockExam);

// Route to delete exam by ID
router.delete('/api/exams/grand-mock/:id', deleteGrandMockExam);
router.delete('/api/exams/:id', deleteExam);

module.exports = router;

