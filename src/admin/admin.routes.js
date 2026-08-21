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
} = require('./admin.controller');
const { requireAdmin } = require('../../middleware/rbac');

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
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Admin Route: Extract MCQs from PDF
router.post('/api/exams/extract-mcqs', requireAdmin, upload.single('pdf'), extractMCQs);

// Admin Route: Create Grand Mock Exam
router.post('/api/exams/grand-mock', requireAdmin, createGrandMockExam);
router.post('/api/exams', requireAdmin, createGrandMockExam);

// Admin Route: Get Summary List of Grand Mock Exams
router.get('/api/exams/grand-mock', getAllGrandMocks);
router.get('/api/exams', getAllGrandMocks);

// Admin Route: Get Single Grand Mock Exam with Questions
router.get('/api/exams/grand-mock/:id', getGrandMockById);
router.get('/api/exams/:id', getGrandMockById);

// Admin Route: Update Grand Mock Exam
router.put('/api/exams/grand-mock/:id', updateGrandMockExam);
router.put('/api/exams/:id', updateGrandMockExam);

// Admin Route: Delete Grand Mock Exam
router.delete('/api/exams/grand-mock/:id', deleteGrandMockExam);
router.delete('/api/exams/:id', deleteExam);

module.exports = router;

