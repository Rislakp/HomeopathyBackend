const express = require('express');
const router = express.Router();
const unaniExamController = require('../controllers/unaniExam.controller');
const { requireAuth, requireAdmin, requireCourseAccess } = require('../../../../middleware/rbac');

// All routes in this module require authentication
router.use(requireAuth);

// ── EXAM CRUD ─────────────────────────────────────────────────────────────
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

// ── QUESTION MANAGEMENT ──────────────────────────────────────────────────
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

// ── STUDENT EXAM TAKING ──────────────────────────────────────────────────
// Start exam
router.post('/api/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.get('/api/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.post('/api/v1/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);
router.get('/api/v1/unani-exams/:examId/start', requireCourseAccess('unani'), unaniExamController.startExam);

// Submit exam
router.post('/api/unani-exams/:examId/submit', requireCourseAccess('unani'), unaniExamController.submitExam);
router.post('/api/v1/unani-exams/:examId/submit', requireCourseAccess('unani'), unaniExamController.submitExam);

// ── RESULTS, RANK & HISTORY ───────────────────────────────────────────────
// Get results summary
router.get('/api/unani-exams/:examId/results', requireCourseAccess('unani'), unaniExamController.getResults);
router.get('/api/v1/unani-exams/:examId/results', requireCourseAccess('unani'), unaniExamController.getResults);

// Get specific result by ID
router.get('/api/unani-exams/:examId/results/:resultId', requireCourseAccess('unani'), unaniExamController.getResultById);
router.get('/api/v1/unani-exams/:examId/results/:resultId', requireCourseAccess('unani'), unaniExamController.getResultById);

// Get leaderboard / rank
router.get('/api/unani-exams/:examId/rank', requireCourseAccess('unani'), unaniExamController.getRank);
router.get('/api/v1/unani-exams/:examId/rank', requireCourseAccess('unani'), unaniExamController.getRank);

// Get history
router.get('/api/unani-exams/:examId/history', requireCourseAccess('unani'), unaniExamController.getHistory);
router.get('/api/v1/unani-exams/:examId/history', requireCourseAccess('unani'), unaniExamController.getHistory);

module.exports = router;
