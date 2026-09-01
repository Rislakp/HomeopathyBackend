const express = require('express');
const router = express.Router();
const { requireRole, requireStudent } = require('../../middleware/rbac');
const {
  getStudentProfile,
  getAvailableExams,
  startExam,
  submitExam,
  getStudentResults,
} = require('./student.controller');
const { downloadAnswerKey } = require('./answerKey.controller');
const requireStudentOrAdmin = requireRole('student', 'admin', 'superadmin');

/**
 * @route   GET /api/student/exams/:id/answer-key/download
 * @route   POST /api/student/exams/:id/answer-key/download
 * @desc    Generate and serve watermarked answer key PDF
 * @access  Private (Student, Admin, Superadmin)
 */
router.get('/api/student/exams/:id/answer-key/download', requireStudentOrAdmin, downloadAnswerKey);
router.post('/api/student/exams/:id/answer-key/download', requireStudentOrAdmin, downloadAnswerKey);

// Faculty routes for students are now handled by routes/studentFacultyRoutes.js

// Protect remaining student routes strictly under /api/student with student role authentication
router.use('/api/student', requireStudent);

/**
 * @route   GET /api/student/exams
 * @desc    Get all available mock tests with student's attempt status & previous score
 */
router.get('/api/student/exams', getAvailableExams);

/**
 * @route   GET /api/student/exams/:id/start
 * @route   POST /api/student/exams/:id/start
 * @desc    Fetch exam questions (sanitized without correctOption) to begin test
 */
router.get('/api/student/exams/:id/start', startExam);
router.post('/api/student/exams/:id/start', startExam);

/**
 * @route   POST /api/student/exams/:id/submit
 * @desc    Submit student answers, evaluate score, and save TestResult
 */
router.post('/api/student/exams/:id/submit', submitExam);

/**
 * @route   GET /api/student/results
 * @desc    Get all test results and performance history for the authenticated student
 */
router.get('/api/student/results', getStudentResults);

module.exports = router;
