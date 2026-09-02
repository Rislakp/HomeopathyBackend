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
  addQuestionToExam,
  updateQuestionInExam,
  deleteQuestionFromExam,
} = require('../controllers/exam.controller');
const { requireAdmin, requireRole } = require('../middleware/rbac');
const { downloadAnswerKey } = require('../src/student/answerKey.controller');

const requireAuthUser = requireRole('student', 'admin', 'superadmin');

// Configure multer to store uploaded files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept PDF, Images, CSV, XLSX, XLS
    if (file.originalname.match(/\.(pdf|png|jpg|jpeg|webp|csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type.'), false);
    }
  },
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
});

// Middleware to gracefully catch Multer specific errors (e.g., Unexpected field, File too large)
const handleExtractUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Multer Error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

// Admin Route: Extract MCQs from uploaded file
router.post('/api/exams/extract-mcqs', requireAdmin, handleExtractUpload, extractMCQs);

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

// Admin Routes: Granular Question operations
router.post('/api/exams/:id/questions', requireAdmin, addQuestionToExam);
router.post('/api/exams/grand-mock/:id/questions', requireAdmin, addQuestionToExam);

router.put('/api/exams/:id/questions/:questionId', requireAdmin, updateQuestionInExam);
router.put('/api/exams/grand-mock/:id/questions/:questionId', requireAdmin, updateQuestionInExam);

router.delete('/api/exams/:id/questions/:questionId', requireAdmin, deleteQuestionFromExam);
router.delete('/api/exams/grand-mock/:id/questions/:questionId', requireAdmin, deleteQuestionFromExam);

// Endpoint to download watermarked answer key PDF
router.get('/api/exams/:id/answer-key/download', requireAuthUser, downloadAnswerKey);
router.post('/api/exams/:id/answer-key/download', requireAuthUser, downloadAnswerKey);
router.get('/api/exams/grand-mock/:id/answer-key/download', requireAuthUser, downloadAnswerKey);
router.post('/api/exams/grand-mock/:id/answer-key/download', requireAuthUser, downloadAnswerKey);

// Route to delete exam by ID
router.delete('/api/exams/grand-mock/:id', deleteGrandMockExam);
router.delete('/api/exams/:id', deleteExam);

module.exports = router;

