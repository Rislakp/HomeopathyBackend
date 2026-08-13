const express = require('express');
const router = express.Router();
const authenticateUser = require('../common/middlewares/auth.middleware');
const {
  getAvailableExams,
  startExam,
  submitExam,
  getStudentResults
} = require('./student.controller');

// Protect all student routes strictly under /api/student with authentication
router.use('/api/student', authenticateUser);

/**
 * @route   GET /api/student/exams
 * @desc    Get all available mock tests with student's attempt status & previous score
 */
router.get('/api/student/exams', getAvailableExams);

/**
 * @route   GET /api/student/exams/:id/start
 * @desc    Fetch exam questions (sanitized without correctOption) to begin test
 */
router.get('/api/student/exams/:id/start', startExam);

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
