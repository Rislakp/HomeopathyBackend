const express = require('express');
const router = express.Router();
const unaniExamController = require('../controllers/unaniExam.controller');
const { requireAuth, requireAdmin, requireCourseAccess } = require('../../../../middleware/rbac');

// All routes in this module require authentication
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// 1. ADMIN UNANI TEST HISTORY & RANK (MUST be declared BEFORE /:id dynamic routes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/unani-exams/history
 * @desc    Fetch all uploaded/created Unani Grand Mock Tests for Admin Portal
 * @access  Private / Admin
 */
router.get('/api/unani-exams/history', requireAdmin, unaniExamController.getUnaniTestHistory);
router.get('/api/v1/unani-exams/history', requireAdmin, unaniExamController.getUnaniTestHistory);

/**
 * @route   GET /api/unani-exams/history/:examId
 * @desc    Fetch single Unani Grand Mock Test details for "View" page
 * @access  Private / Admin
 */
router.get('/api/unani-exams/history/:examId', requireAdmin, unaniExamController.getUnaniTestHistoryById);
router.get('/api/v1/unani-exams/history/:examId', requireAdmin, unaniExamController.getUnaniTestHistoryById);

/**
 * @route   DELETE /api/unani-exams/history/:examId
 * @desc    Delete an Unani Grand Mock Test from Admin Test History
 * @access  Private / Admin
 */
router.delete('/api/unani-exams/history/:examId', requireAdmin, unaniExamController.deleteUnaniTest);
router.delete('/api/v1/unani-exams/history/:examId', requireAdmin, unaniExamController.deleteUnaniTest);

/**
 * @route   GET /api/unani-exams/:examId/rank
 * @route   GET /api/unani-exams/history/:examId/rank
 * @desc    Return rank / leaderboard for ONE Unani Grand Mock Test
 * @access  Private / Admin
 */
router.get('/api/unani-exams/history/:examId/rank', requireAdmin, unaniExamController.getRank);
router.get('/api/v1/unani-exams/history/:examId/rank', requireAdmin, unaniExamController.getRank);
router.get('/api/unani-exams/:examId/rank', requireAdmin, unaniExamController.getRank);
router.get('/api/v1/unani-exams/:examId/rank', requireAdmin, unaniExamController.getRank);

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXAM CRUD
// ─────────────────────────────────────────────────────────────────────────────

// Admin create
router.post('/api/unani-exams', requireAdmin, unaniExamController.createExam);
router.post('/api/v1/unani-exams', requireAdmin, unaniExamController.createExam);

// Get all (Student enrolled in 'unani' or Admin)
router.get('/api/unani-exams', requireCourseAccess('unani'), unaniExamController.getAllExams);
router.get('/api/v1/unani-exams', requireCourseAccess('unani'), unaniExamController.getAllExams);

// Get single (Student enrolled in 'unani' or Admin)
router.get('/api/unani-exams/:id', requireCourseAccess('unani'), unaniExamController.getExamById);
router.get('/api/v1/unani-exams/:id', requireCourseAccess('unani'), unaniExamController.getExamById);

// Admin update & delete
router.put('/api/unani-exams/:id', requireAdmin, unaniExamController.updateExam);
router.put('/api/v1/unani-exams/:id', requireAdmin, unaniExamController.updateExam);

router.delete('/api/unani-exams/:id', requireAdmin, unaniExamController.deleteExam);
router.delete('/api/v1/unani-exams/:id', requireAdmin, unaniExamController.deleteExam);

// ─────────────────────────────────────────────────────────────────────────────
// 3. QUESTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// Bulk add questions (Admin)
router.post('/api/unani-exams/:examId/questions/bulk', requireAdmin, unaniExamController.addQuestionsBulk);
router.post('/api/v1/unani-exams/:examId/questions/bulk', requireAdmin, unaniExamController.addQuestionsBulk);

// Single question operations
router.post('/api/unani-exams/:examId/questions', requireAdmin, unaniExamController.addQuestion);
router.post('/api/v1/unani-exams/:examId/questions', requireAdmin, unaniExamController.addQuestion);

router.get('/api/unani-exams/:examId/questions', requireCourseAccess('unani'), unaniExamController.getQuestions);
router.get('/api/v1/unani-exams/:examId/questions', requireCourseAccess('unani'), unaniExamController.getQuestions);

router.get('/api/unani-exams/:examId/questions/:questionId', requireCourseAccess('unani'), unaniExamController.getQuestionById);
router.get('/api/v1/unani-exams/:examId/questions/:questionId', requireCourseAccess('unani'), unaniExamController.getQuestionById);

router.put('/api/unani-exams/:examId/questions/:questionId', requireAdmin, unaniExamController.updateQuestion);
router.put('/api/v1/unani-exams/:examId/questions/:questionId', requireAdmin, unaniExamController.updateQuestion);

router.delete('/api/unani-exams/:examId/questions/:questionId', requireAdmin, unaniExamController.deleteQuestion);
router.delete('/api/v1/unani-exams/:examId/questions/:questionId', requireAdmin, unaniExamController.deleteQuestion);

// ─────────────────────────────────────────────────────────────────────────────
// 4. STUDENT EXAM TAKING
// ─────────────────────────────────────────────────────────────────────────────

// Start exam
router.post('/api/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.get('/api/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.post('/api/v1/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.get('/api/v1/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);

// Submit exam
router.post('/api/unani-exams/:examId/submit', requireCourseAccess('unani'), unaniExamController.submitExam);
router.post('/api/v1/unani-exams/:examId/submit', requireCourseAccess('unani'), unaniExamController.submitExam);

// ─────────────────────────────────────────────────────────────────────────────
// 5. RESULTS & HISTORY (STUDENT)
// ─────────────────────────────────────────────────────────────────────────────

// Get results summary
router.get('/api/unani-exams/:examId/results', requireCourseAccess('unani'), unaniExamController.getResults);
router.get('/api/v1/unani-exams/:examId/results', requireCourseAccess('unani'), unaniExamController.getResults);

// Get specific result by ID
router.get('/api/unani-exams/:examId/results/:resultId', requireCourseAccess('unani'), unaniExamController.getResultById);
router.get('/api/v1/unani-exams/:examId/results/:resultId', requireCourseAccess('unani'), unaniExamController.getResultById);

// Get student exam history
router.get('/api/unani-exams/:examId/history', requireCourseAccess('unani'), unaniExamController.getHistory);
router.get('/api/v1/unani-exams/:examId/history', requireCourseAccess('unani'), unaniExamController.getHistory);

module.exports = router;
