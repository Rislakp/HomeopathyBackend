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
} = require('./admin.controller');
const { requireAdmin } = require('../../middleware/rbac');

// Multer memory storage configuration for PDF upload
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

// Admin Route: Extract MCQs from uploaded file
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

router.post('/api/exams/extract-mcqs', requireAdmin, handleExtractUpload, extractMCQs);

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

// Admin Routes: Granular Question operations
router.post('/api/exams/:id/questions', requireAdmin, addQuestionToExam);
router.post('/api/exams/grand-mock/:id/questions', requireAdmin, addQuestionToExam);

router.put('/api/exams/:id/questions/:questionId', requireAdmin, updateQuestionInExam);
router.put('/api/exams/grand-mock/:id/questions/:questionId', requireAdmin, updateQuestionInExam);

router.delete('/api/exams/:id/questions/:questionId', requireAdmin, deleteQuestionFromExam);
router.delete('/api/exams/grand-mock/:id/questions/:questionId', requireAdmin, deleteQuestionFromExam);

// Admin Route: Delete Grand Mock Exam
router.delete('/api/exams/grand-mock/:id', deleteGrandMockExam);
router.delete('/api/exams/:id', deleteExam);

module.exports = router;

