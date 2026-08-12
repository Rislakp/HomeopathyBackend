const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById
} = require('./admin.controller');

// Multer memory storage configuration for PDF upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Admin Route: Extract MCQs from PDF
router.post('/api/exams/extract-mcqs', upload.single('pdf'), extractMCQs);

// Admin Route: Create Grand Mock Exam
router.post('/api/exams/grand-mock', createGrandMockExam);

// Admin Route: Get Summary List of Grand Mock Exams
router.get('/api/exams/grand-mock', getAllGrandMocks);

// Admin Route: Get Single Grand Mock Exam with Questions
router.get('/api/exams/grand-mock/:id', getGrandMockById);

module.exports = router;
