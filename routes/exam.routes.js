const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById
} = require('../controllers/exam.controller');

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
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Endpoint to extract MCQs from PDF
router.post('/api/exams/extract-mcqs', upload.single('pdf'), extractMCQs);

// Endpoint to save verified exam document
router.post('/api/exams/grand-mock', createGrandMockExam);

// Endpoint to get all Grand Mock exams (Summary list without questions)
router.get('/api/exams/grand-mock', getAllGrandMocks);

// Endpoint to get single Grand Mock exam details (Including questions)
router.get('/api/exams/grand-mock/:id', getGrandMockById);

module.exports = router;
