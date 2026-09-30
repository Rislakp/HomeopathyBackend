const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const { requireAdmin, requireRole } = require('../middleware/rbac');
const requireAuthUser = requireRole('student', 'admin', 'superadmin');
const { startExam, submitExam } = require('../src/student/student.controller');
const unaniExamController = require('../src/unani/exams/controllers/unaniExam.controller');
const { adminAuth } = require('../middleware/adminAuth.middleware');
const {
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById,
  updateGrandMockExam,
  deleteGrandMockExam,
  deleteExam,
  addQuestionToExam,
  updateQuestionInExam,
  deleteQuestionFromExam,
} = require('../controllers/examController');

// ---------------------------------------------------------------------------
// 1. GET /api/unani-exams/history - Paginated Unani Exam History
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { courseId: /^unani$/i },
        { category: /^unani$/i },
        { title: /unani/i },
      ],
    };

    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      query.title = new RegExp(req.query.search.trim(), 'i');
    }

    const total = await Exam.countDocuments(query);
    const exams = await Exam.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get attendance counts from TestResult
    const examIds = exams.map((e) => e._id);
    let attendanceMap = {};
    if (examIds.length > 0 && TestResult) {
      const counts = await TestResult.aggregate([
        { $match: { examId: { $in: examIds } } },
        { $group: { _id: '$examId', count: { $sum: 1 } } },
      ]);
      counts.forEach((c) => {
        attendanceMap[c._id.toString()] = c.count;
      });
    }

    const formattedTests = exams.map((e) => ({
      _id: e._id.toString(),
      id: e._id.toString(),
      title: e.title || '',
      testType: e.testType || 'grand_mock_test',
      courseId: e.courseId || 'unani',
      totalQuestions: e.questions ? e.questions.length : (e.totalQuestions || 0),
      duration: e.durationMinutes || e.duration || 0,
      attendedCount: attendanceMap[e._id.toString()] || e.attendedCount || 0,
      createdAt: e.createdAt || new Date().toISOString(),
    }));

    return res.status(200).json({
      success: true,
      data: {
        tests: formattedTests,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('Error fetching unani exam history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani test history',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// 2. GET /api/unani-exams/history/:examId - Single Unani Exam Details
// ---------------------------------------------------------------------------
router.get('/history/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    let exam = null;
    if (mongoose.Types.ObjectId.isValid(examId)) {
      exam = await Exam.findById(examId).lean();
    }
    if (!exam) {
      exam = await Exam.findOne({ $or: [{ _id: examId }, { id: examId }] }).lean();
    }

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: exam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam details',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// 3. DELETE /api/unani-exams/history/:examId - Delete Unani Exam History
// ---------------------------------------------------------------------------
router.delete('/history/:examId', adminAuth, async (req, res) => {
  try {
    const { examId } = req.params;
    if (mongoose.Types.ObjectId.isValid(examId)) {
      await Exam.findByIdAndDelete(examId);
      if (TestResult) {
        await TestResult.deleteMany({ examId });
      }
    }
    return res.status(200).json({
      success: true,
      message: 'Unani exam history deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Unani exam history',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// 4. GET /api/unani-exams/:examId/rank - Unani Exam Leaderboard with Student Avatar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4b. PUT /api/unani-exams/:examId/rank-image - Update Unani Rank Student Profile Image
// ---------------------------------------------------------------------------
router.put('/:examId/rank-image', adminAuth, async (req, res) => {
  try {
    const { studentId, imageUrl, profileImage, avatar } = req.body;
    const finalUrl = (imageUrl || profileImage || avatar || '').trim();

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: 'studentId is required to update student rank profile image',
      });
    }

    if (!finalUrl) {
      return res.status(400).json({
        success: false,
        message: 'A valid imageUrl/profileImage is required',
      });
    }

    // Update Student model
    let updatedStudent = null;
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      updatedStudent = await Student.findByIdAndUpdate(
        studentId,
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }
    if (!updatedStudent) {
      updatedStudent = await Student.findOneAndUpdate(
        { $or: [{ studentId }, { email: studentId }, { userId: studentId }] },
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }

    // Also update User model if exists
    let updatedUser = null;
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      updatedUser = await User.findByIdAndUpdate(
        studentId,
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }
    if (!updatedUser && updatedStudent && updatedStudent.userId) {
      updatedUser = await User.findByIdAndUpdate(
        updatedStudent.userId,
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Unani rank student profile image updated successfully',
      data: {
        studentId,
        profileImage: finalUrl,
        imageUrl: finalUrl,
        avatar: finalUrl,
      },
    });
  } catch (error) {
    console.error('Error updating unani rank image:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani rank student profile image',
      error: error.message,
    });
  }
});

router.post('/:examId/rank-image', adminAuth, async (req, res, next) => {
  req.method = 'PUT';
  return router.handle(req, res, next);
});

// ---------------------------------------------------------------------------
// 4c. DELETE /api/unani-exams/:examId/rank-image - Delete Unani Rank Student Profile Image
// ---------------------------------------------------------------------------
router.delete('/:examId/rank-image', adminAuth, async (req, res) => {
  try {
    const studentId = req.body.studentId || req.query.studentId;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: 'studentId is required to delete student rank profile image',
      });
    }

    // Clear profile image from Student model
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      await Student.findByIdAndUpdate(studentId, { profileImage: '', avatar: '' });
    }
    await Student.findOneAndUpdate(
      { $or: [{ studentId }, { email: studentId }, { userId: studentId }] },
      { profileImage: '', avatar: '' }
    );

    // Clear from User model
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      await User.findByIdAndUpdate(studentId, { profileImage: '', avatar: '' });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani rank student profile image removed successfully',
      data: {
        studentId,
        profileImage: null,
      },
    });
  } catch (error) {
    console.error('Error deleting unani rank image:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Unani rank student profile image',
      error: error.message,
    });
  }
});

router.get('/:examId/rank', async (req, res) => {
  try {
    const { examId } = req.params;
    let exam = null;
    if (mongoose.Types.ObjectId.isValid(examId)) {
      exam = await Exam.findById(examId).lean();
    }
    if (!exam) {
      exam = await Exam.findOne({ $or: [{ _id: examId }, { id: examId }] }).lean();
    }

    let testResults = [];
    if (mongoose.Types.ObjectId.isValid(examId) && TestResult) {
      testResults = await TestResult.find({ examId })
        .sort({ score: -1, createdAt: 1 })
        .lean();
    }

    const rankings = [];
    let rankIdx = 1;

    for (const result of testResults) {
      let student = null;
      let user = null;

      if (result.studentId) {
        if (mongoose.Types.ObjectId.isValid(result.studentId)) {
          student = await Student.findById(result.studentId).lean();
          if (!student) {
            user = await User.findById(result.studentId).lean();
            if (user) {
              student = await Student.findOne({ $or: [{ userId: user._id }, { email: user.email }] }).lean();
            }
          }
        }
        if (!student && !user) {
          student = await Student.findOne({
            $or: [{ studentId: result.studentId }, { email: result.studentId }],
          }).lean();
        }
      }

      const studentName = student?.name || user?.name || result.studentName || 'Student';
      const studentIdStr = student?._id?.toString() || user?._id?.toString() || result.studentId?.toString() || '';
      const profileImage =
        student?.profileImage ||
        student?.avatar ||
        user?.profileImage ||
        user?.avatar ||
        '';

      rankings.push({
        rank: rankIdx++,
        studentId: studentIdStr,
        studentName,
        name: studentName,
        score: result.score || 0,
        correct: result.totalCorrect || 0,
        wrong: result.totalWrong || 0,
        unanswered: result.unansweredQuestions || 0,
        percentage:
          result.percentage !== undefined
            ? result.percentage
            : (result.totalMarks > 0 ? (result.score / result.totalMarks) * 100 : 0),
        timeTakenSeconds: result.timeTakenSeconds || 0,
        submittedAt: result.createdAt,
        submittedAtRaw: result.createdAt ? result.createdAt.toISOString() : null,
        profileImage,
        avatar: profileImage,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        exam: exam
          ? {
              id: exam._id?.toString() || examId,
              _id: exam._id?.toString() || examId,
              title: exam.title || 'Unani Test',
              courseId: exam.courseId || 'unani',
              examType: exam.testType || 'grand_mock_test',
              totalQuestions: exam.questions ? exam.questions.length : (exam.totalQuestions || 0),
              duration: exam.durationMinutes || exam.duration || 0,
            }
          : null,
        rankings,
      },
    });
  } catch (error) {
    console.error('Error fetching unani exam rank:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam rankings',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 4d. Student Unani Exam Endpoints (Declared BEFORE /:id dynamic route)
// ---------------------------------------------------------------------------
router.get('/student', requireAuthUser, unaniExamController.getStudentAvailableExams);
router.get('/student/:examId', requireAuthUser, unaniExamController.getStudentExamById);
router.post('/student/:examId/submit', requireAuthUser, unaniExamController.submitStudentExam);
router.get('/student/:examId/result', requireAuthUser, unaniExamController.getStudentResultByExam);

// 5. Unani Exam CRUD & Questions endpoints (reusing existing exam controller)
// ---------------------------------------------------------------------------
router.get('/', (req, res, next) => {
  req.query.courseId = 'unani';
  return getAllGrandMocks(req, res, next);
});

router.post('/', adminAuth, (req, res, next) => {
  req.body.courseId = 'unani';
  req.body.testType = req.body.testType || 'grand_mock_test';
  return createGrandMockExam(req, res, next);
});

router.get('/:id', getGrandMockById);
router.put('/:id', adminAuth, updateGrandMockExam);
router.delete('/:id', adminAuth, deleteGrandMockExam);

// Question operations
router.post('/:id/questions', adminAuth, addQuestionToExam);
router.post('/:examId/questions/bulk', adminAuth, async (req, res) => {
  try {
    const { examId } = req.params;
    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Questions array is required.' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }
    for (const q of questions) {
      exam.questions.push(q);
    }
    exam.totalQuestions = exam.questions.length;
    await exam.save();
    return res.status(200).json({
      success: true,
      message: questions.length + ' questions added successfully.',
      data: exam,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
router.put('/:id/questions/:questionId', adminAuth, updateQuestionInExam);
router.delete('/:id/questions/:questionId', adminAuth, deleteQuestionFromExam);

// ---------------------------------------------------------------------------
// 6. Student Exam Taking: Start & Submit
// ---------------------------------------------------------------------------
router.post('/:id/start', requireAuthUser, startExam);
router.get('/:id/start', requireAuthUser, startExam);
router.post('/:id/submit', requireAuthUser, submitExam);

module.exports = router;
