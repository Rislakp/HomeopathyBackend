const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { buildPdfWatermark } = require('../../../student/answerKey.controller');
const UnaniExam = require('../models/unaniExam.model');
const UnaniExamResult = require('../models/unaniExamResult.model');
let Exam;
try {
  Exam = require('../../../../models/Exam');
} catch (e) {
  // Exam model optional
}
let TestResult;
try {
  TestResult = require('../../../common/models/testResult.model');
} catch (e) {
  // TestResult model optional
}
let Student;
try {
  Student = require('../../../../models/Student');
} catch (e) {
  // Student model optional
}

/**
 * Resolve authenticated studentId from req.user
 */
async function resolveStudentId(reqUser) {
  if (!reqUser) return null;
  const userId = reqUser.studentId || reqUser.userId || reqUser.id;

  if (Student) {
    let student = null;
    if (reqUser.studentId && mongoose.Types.ObjectId.isValid(reqUser.studentId)) {
      student = await Student.findById(reqUser.studentId);
    }
    if (!student && userId && mongoose.Types.ObjectId.isValid(userId)) {
      student = await Student.findOne({ userId });
      if (!student) {
        student = await Student.findById(userId);
      }
    }
    if (!student && reqUser.email) {
      student = await Student.findOne({ email: reqUser.email.toLowerCase() });
    }
    if (student) {
      return student._id;
    }
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }

  return null;
}

/**
 * Create a new Unani exam
 */
async function createExam(examData) {
  const sanitized = {
    title: String(examData.title || '').trim(),
    description: String(examData.description || '').trim(),
    examType: 'grand_mock_test',
    courseId: 'unani',
    marksPerQuestion: Number(examData.marksPerQuestion),
    negativeMark: Number(examData.negativeMark || examData.negativeMarkPenalty || 0),
    negativeMarkPenalty: Number(examData.negativeMarkPenalty || examData.negativeMark || 0),
    durationMinutes: Number(examData.durationMinutes),
    status: examData.status || 'Published',
    questions: Array.isArray(examData.questions) ? examData.questions : [],
  };
  sanitized.totalQuestions = sanitized.questions.length;

  const exam = new UnaniExam(sanitized);
  return await exam.save();
}

/**
 * Get all Unani exams
 */
async function getAllExams({ page = 1, limit = 20, search = '', status = '' } = {}) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
  const filter = { courseId: 'unani', examType: 'grand_mock_test' };
  if (status && String(status).toLowerCase() !== 'all') filter.status = String(status);
  if (search && String(search).trim()) {
    filter.title = { $regex: String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  const [total, exams] = await Promise.all([
    UnaniExam.countDocuments(filter),
    UnaniExam.find(filter)
      .select('_id title description examType courseId totalQuestions marksPerQuestion negativeMark negativeMarkPenalty durationMinutes status createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);
  return { exams, total, page: pageNum, limit: limitNum };
}

/**
 * Get single Unani exam by ID
 */
async function getExamById(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  return await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
}

/**
 * Update Unani exam by ID
 */
async function updateExam(examId, updateData) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  if (updateData.title !== undefined) exam.title = String(updateData.title).trim();
  if (updateData.description !== undefined) exam.description = String(updateData.description).trim();
  if (updateData.marksPerQuestion !== undefined) exam.marksPerQuestion = Number(updateData.marksPerQuestion);
  if (updateData.negativeMark !== undefined || updateData.negativeMarkPenalty !== undefined) {
    const neg = Number(updateData.negativeMark ?? updateData.negativeMarkPenalty ?? 0);
    exam.negativeMark = neg;
    exam.negativeMarkPenalty = neg;
  }
  if (updateData.durationMinutes !== undefined) exam.durationMinutes = Number(updateData.durationMinutes);
  if (updateData.status !== undefined) exam.status = updateData.status;

  // Always force courseId & examType
  exam.courseId = 'unani';
  exam.examType = 'grand_mock_test';
  exam.totalQuestions = exam.questions ? exam.questions.length : 0;

  return await exam.save();
}

/**
 * Delete Unani exam by ID
 */
async function deleteExam(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  return await UnaniExam.findOneAndDelete({ _id: examId, courseId: 'unani' });
}

/**
 * Add a single question to an exam
 */
async function addQuestion(examId, questionData) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  exam.questions.push({
    questionText: String(questionData.questionText).trim(),
    passage: questionData.passage ? String(questionData.passage).trim() : null,
    imageUrl: questionData.imageUrl ? String(questionData.imageUrl).trim() : null,
    tableData: questionData.tableData || null,
    options: {
      A: String(questionData.options.A).trim(),
      B: String(questionData.options.B).trim(),
      C: String(questionData.options.C).trim(),
      D: String(questionData.options.D).trim(),
    },
    correctOption: String(questionData.correctOption).toUpperCase().trim(),
    explanation: questionData.explanation ? String(questionData.explanation).trim() : '',
  });

  exam.totalQuestions = exam.questions.length;
  await exam.save();
  return exam;
}

/**
 * Get all questions for an exam
 */
async function getQuestions(examId, isStudent = false) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  if (isStudent) {
    return exam.questions.map((q) => {
      const qObj = q.toObject ? q.toObject() : { ...q };
      delete qObj.correctOption;
      delete qObj.explanation;
      return qObj;
    });
  }

  return exam.questions;
}

/**
 * Get a single question by ID
 */
async function getQuestionById(examId, questionId) {
  if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(questionId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  return exam.questions.id(questionId);
}

/**
 * Update a question in an exam
 */
async function updateQuestion(examId, questionId, updateData) {
  if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(questionId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  const q = exam.questions.id(questionId);
  if (!q) return null;

  if (updateData.questionText !== undefined) q.questionText = String(updateData.questionText).trim();
  if (updateData.passage !== undefined) q.passage = updateData.passage ? String(updateData.passage).trim() : null;
  if (updateData.imageUrl !== undefined) q.imageUrl = updateData.imageUrl ? String(updateData.imageUrl).trim() : null;
  if (updateData.tableData !== undefined) q.tableData = updateData.tableData;
  if (updateData.options) {
    if (updateData.options.A !== undefined) q.options.A = String(updateData.options.A).trim();
    if (updateData.options.B !== undefined) q.options.B = String(updateData.options.B).trim();
    if (updateData.options.C !== undefined) q.options.C = String(updateData.options.C).trim();
    if (updateData.options.D !== undefined) q.options.D = String(updateData.options.D).trim();
  }
  if (updateData.correctOption !== undefined) q.correctOption = String(updateData.correctOption).toUpperCase().trim();
  if (updateData.explanation !== undefined) q.explanation = String(updateData.explanation).trim();

  await exam.save();
  return exam;
}

/**
 * Delete a question from an exam
 */
async function deleteQuestion(examId, questionId) {
  if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(questionId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  exam.questions.pull({ _id: questionId });
  exam.totalQuestions = exam.questions.length;
  await exam.save();
  return exam;
}

/**
 * Bulk add questions to an exam
 */
async function addQuestionsBulk(examId, questionsList) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  if (Array.isArray(questionsList)) {
    questionsList.forEach((q) => {
      exam.questions.push({
        questionText: String(q.questionText || '').trim(),
        passage: q.passage ? String(q.passage).trim() : null,
        imageUrl: q.imageUrl ? String(q.imageUrl).trim() : null,
        tableData: q.tableData || null,
        options: {
          A: String(q.options?.A || '').trim(),
          B: String(q.options?.B || '').trim(),
          C: String(q.options?.C || '').trim(),
          D: String(q.options?.D || '').trim(),
        },
        correctOption: String(q.correctOption || 'A').toUpperCase().trim(),
        explanation: q.explanation ? String(q.explanation).trim() : '',
      });
    });
  }

  exam.totalQuestions = exam.questions.length;
  await exam.save();
  return exam;
}

/**
 * Start an exam (for student)
 */
async function startExam(examId, reqUser) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return null;

  let completedCount = 0;
  if (reqUser) {
    try {
      const studentId = await resolveStudentId(reqUser);
      if (studentId) {
        completedCount = await UnaniExamResult.countDocuments({
          examId: exam._id,
          studentId: studentId,
        });
      }
    } catch (e) {}
  }

  const maxAttempts = Number(exam.maxAttempts || exam.attemptLimit) || 0;
  if (maxAttempts > 0 && completedCount >= maxAttempts) {
    return { error: `Maximum attempts (${maxAttempts}) reached for this exam.` };
  }

  const sanitizedQuestions = exam.questions.map((q) => {
    const qObj = q.toObject ? q.toObject() : { ...q };
    delete qObj.correctOption;
    delete qObj.explanation;
    return qObj;
  });

  return {
    examId: exam._id.toString(),
    title: exam.title,
    description: exam.description,
    courseId: 'unani',
    examType: 'grand_mock_test',
    durationMinutes: exam.durationMinutes,
    totalQuestions: exam.questions.length,
    marksPerQuestion: exam.marksPerQuestion,
    negativeMark: exam.negativeMark,
    attemptNumber: completedCount + 1,
    totalAttempts: completedCount,
    isReattempt: completedCount > 0,
    questions: sanitizedQuestions,
  };
}

/**
 * Submit exam answers and compute test result
 */
async function submitExam(examId, reqUser, submissionData) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return { error: 'Invalid exam ID' };
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) return { error: 'Unani Exam not found' };

  const studentId = await resolveStudentId(reqUser);
  if (!studentId) return { error: 'Authenticated student record not found' };

  const submittedAnswers = submissionData.answers || submissionData.responses || [];
  const marksPerQuestion = exam.marksPerQuestion || 1;
  const penalty = exam.negativeMark || exam.negativeMarkPenalty || 0;
  const totalQuestions = exam.questions.length;
  const totalMarks = totalQuestions * marksPerQuestion;

  let correctAnswers = 0;
  let wrongAnswers = 0;
  let unanswered = 0;
  let score = 0;

  const answersEvaluated = exam.questions.map((question) => {
    const qIdStr = question._id.toString();
    const userAns = submittedAnswers.find(
      (a) => (a.questionId && a.questionId.toString() === qIdStr) || (a.id && a.id.toString() === qIdStr)
    );

    const selectedOption = userAns && userAns.selectedOption ? String(userAns.selectedOption).toUpperCase().trim() : null;
    const correctOption = String(question.correctOption).toUpperCase().trim();

    let isCorrect = false;
    if (selectedOption) {
      if (selectedOption === correctOption) {
        isCorrect = true;
        correctAnswers++;
        score += marksPerQuestion;
      } else {
        wrongAnswers++;
        score -= penalty;
      }
    } else {
      unanswered++;
    }

    return {
      questionId: question._id,
      selectedOption: selectedOption,
      correctOption: correctOption,
      isCorrect: isCorrect,
    };
  });

  score = Math.max(0, Math.round(score * 100) / 100);
  const percentage = totalMarks > 0 ? Math.max(0, Math.round((score / totalMarks) * 100 * 100) / 100) : 0;
  const timeTakenSeconds = Number(submissionData.timeTakenSeconds || submissionData.timeTaken || 0);

  const previousResults = await UnaniExamResult.find({
    examId: exam._id,
    studentId: studentId,
  }).sort({ createdAt: -1 });

  // Idempotency: if rapid duplicate submission within 3 seconds, return existing result
  if (previousResults.length > 0) {
    const latestAttempt = previousResults[0];
    const diffMs = Date.now() - new Date(latestAttempt.createdAt || latestAttempt.updatedAt).getTime();
    if (diffMs < 3000) {
      const bScore = previousResults.reduce((max, r) => (r.score > max ? r.score : max), latestAttempt.score);
      const resObj = latestAttempt.toObject ? latestAttempt.toObject() : latestAttempt;
      return {
        ...resObj,
        attemptNumber: latestAttempt.attemptNumber || previousResults.length,
        totalAttempts: previousResults.length,
        attempts: previousResults.length,
        latestScore: latestAttempt.score,
        bestScore: bScore,
      };
    }
  }

  const attemptNumber = previousResults.length + 1;
  const bestScore = previousResults.reduce((max, r) => (r.score > max ? r.score : max), score);

  const result = new UnaniExamResult({
    studentId: studentId,
    examId: exam._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
    attemptNumber: attemptNumber,
    score: score,
    totalMarks: totalMarks,
    percentage: percentage,
    correctAnswers: correctAnswers,
    wrongAnswers: wrongAnswers,
    unanswered: unanswered,
    answers: answersEvaluated,
    status: 'Completed',
    timeTakenSeconds: timeTakenSeconds,
  });

  await result.save();
  const resObj = result.toObject ? result.toObject() : { ...result._doc };
  return {
    ...resObj,
    attemptNumber: attemptNumber,
    totalAttempts: attemptNumber,
    attempts: attemptNumber,
    latestScore: score,
    bestScore: bestScore,
  };
}

/**
 * Get results for an exam
 */
async function getResults(examId, reqUser) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return [];
  const userRole = (reqUser?.role || '').toLowerCase().trim();

  if (['admin', 'superadmin'].includes(userRole)) {
    return await UnaniExamResult.find({ examId, courseId: 'unani' })
      .populate('studentId', 'name email phone')
      .sort({ score: -1, createdAt: -1 });
  }

  const studentId = await resolveStudentId(reqUser);
  if (!studentId) return [];

  return await UnaniExamResult.find({ examId, studentId, courseId: 'unani' }).sort({ createdAt: -1 });
}

/**
 * Get a specific result by ID (enforcing student ownership)
 */
async function getResultById(examId, resultId, reqUser) {
  if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(resultId)) return null;
  const userRole = (reqUser?.role || '').toLowerCase().trim();

  const result = await UnaniExamResult.findOne({ _id: resultId, examId, courseId: 'unani' }).populate(
    'studentId',
    'name email phone'
  );

  if (!result) return null;

  if (['admin', 'superadmin'].includes(userRole)) {
    const resultObj = result.toObject ? result.toObject() : { ...result };
    const exam = await UnaniExam.findById(examId).select('title marksPerQuestion negativeMark negativeMarkPenalty totalQuestions questions').lean();
    if (exam) {
      const formatted = formatUnaniAnswerKey(exam, result);
      resultObj.questions = formatted.questions;
      resultObj.answers = formatted.questions;
      resultObj.examTitle = exam.title || '';
    }
    return resultObj;
  }

  const studentId = await resolveStudentId(reqUser);
  const resultStudentId = result.studentId?._id ? result.studentId._id.toString() : (result.studentId ? result.studentId.toString() : '');
  if (!studentId || resultStudentId !== studentId.toString()) {
    return { forbidden: true };
  }

  const resultObj = result.toObject ? result.toObject() : { ...result };
  const exam = await UnaniExam.findById(examId).select('title marksPerQuestion negativeMark negativeMarkPenalty totalQuestions questions').lean();
  if (exam) {
    const formatted = formatUnaniAnswerKey(exam, result);
    resultObj.questions = formatted.questions;
    resultObj.answers = formatted.questions;
    resultObj.examTitle = exam.title || '';
  }

  return resultObj;
}

/**
 * Get all Unani Grand Mock Tests history for Admin Portal with attended count and pagination
 */
async function getUnaniTestHistory({ page = 1, limit = 50, search = '' } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    courseId: 'unani',
    examType: 'grand_mock_test',
  };

  if (search && String(search).trim()) {
    filter.title = { $regex: String(search).trim(), $options: 'i' };
  }

  const [exams, total] = await Promise.all([
    UnaniExam.find(filter)
      .select('-questions')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    UnaniExam.countDocuments(filter),
  ]);

  if (exams.length === 0) {
    return { tests: [], total: 0, page: pageNum, limit: limitNum };
  }

  const examIds = exams.map((e) => e._id);

  // Aggregate distinct students who attended each exam
  const attendanceAgg = await UnaniExamResult.aggregate([
    {
      $match: {
        examId: { $in: examIds },
        courseId: 'unani',
        examType: 'grand_mock_test',
      },
    },
    {
      $group: {
        _id: '$examId',
        distinctStudents: { $addToSet: '$studentId' },
      },
    },
    {
      $project: {
        _id: 1,
        attended: { $size: '$distinctStudents' },
      },
    },
  ]);

  const attendanceMap = {};
  attendanceAgg.forEach((a) => {
    attendanceMap[a._id.toString()] = a.attended;
  });

  const formattedTests = exams.map((exam) => ({
    _id: exam._id.toString(),
    id: exam._id.toString(),
    title: exam.title,
    description: exam.description || '',
    courseId: 'unani',
    examType: 'grand_mock_test',
    totalQuestions: exam.totalQuestions || (Array.isArray(exam.questions) ? exam.questions.length : 0),
    durationMinutes: exam.durationMinutes,
    marksPerQuestion: exam.marksPerQuestion,
    negativeMark: exam.negativeMark || exam.negativeMarkPenalty || 0,
    negativeMarkPenalty: exam.negativeMarkPenalty || exam.negativeMark || 0,
    status: exam.status || 'Published',
    attended: attendanceMap[exam._id.toString()] || 0,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
  }));

  return {
    tests: formattedTests,
    total,
    page: pageNum,
    limit: limitNum,
  };
}

/**
 * Get single Unani Grand Mock Test for View page
 */
async function getUnaniTestHistoryById(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;

  const exam = await UnaniExam.findOne({
    _id: examId,
    courseId: 'unani',
    examType: 'grand_mock_test',
  });

  if (!exam) return null;

  const attendedCount = await UnaniExamResult.distinct('studentId', {
    examId: exam._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
  });

  const examObj = exam.toObject ? exam.toObject() : { ...exam };
  examObj.id = exam._id.toString();
  examObj._id = exam._id.toString();
  examObj.attended = attendedCount ? attendedCount.length : 0;
  return examObj;
}

/**
 * Delete Unani Grand Mock Test and clean up associated Unani results without touching Student data
 */
async function deleteUnaniTest(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;

  const exam = await UnaniExam.findOne({
    _id: examId,
    courseId: 'unani',
    examType: 'grand_mock_test',
  });

  if (!exam) return null;

  // 1. Delete associated exam results in UnaniExamResult collection only
  await UnaniExamResult.deleteMany({
    examId: exam._id,
    courseId: 'unani',
  });

  // 2. Delete the exam itself
  await UnaniExam.findByIdAndDelete(exam._id);

  return true;
}

/**
 * Get exam leaderboard / ranking for ONE Unani Grand Mock Test
 */
async function getRank(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return null;

  const exam = await UnaniExam.findOne({
    _id: examId,
    courseId: 'unani',
    examType: 'grand_mock_test',
  });

  if (!exam) return null;

  const results = await UnaniExamResult.find({
    examId: exam._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
  })
    .populate('studentId', 'name email phone userId profileImage avatar')
    .sort({ score: -1, percentage: -1, createdAt: 1 })
    .lean();

  // Batch-resolve missing student names from User model (replaces N+1 per-result lookup)
  let User;
  try {
    User = require('../../../../models/User');
  } catch (e) {}

  let userNameMap = new Map();
  if (User) {
    const missingNameStudents = results.filter(r => r.studentId && !r.studentId.name);
    const userIdSet = new Set();
    const emailSet = new Set();
    for (const r of missingNameStudents) {
      if (r.studentId.userId) userIdSet.add(r.studentId.userId.toString());
      if (r.studentId.email) emailSet.add(r.studentId.email.toLowerCase().trim());
    }

    if (userIdSet.size > 0 || emailSet.size > 0) {
      try {
        const userOrFilter = [];
        if (userIdSet.size > 0) {
          userOrFilter.push({ _id: { $in: [...userIdSet].filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id)) } });
        }
        if (emailSet.size > 0) {
          userOrFilter.push({ email: { $in: [...emailSet] } });
        }
        const users = await User.find({ $or: userOrFilter }).select('name email').lean();
        for (const u of users) {
          if (u._id) userNameMap.set(u._id.toString(), u.name || '');
          if (u.email) userNameMap.set(u.email.toLowerCase().trim(), u.name || '');
        }
      } catch (e) {}
    }
  }

  const rankings = results.map((res, index) => {
    let studentName = res.studentId ? res.studentId.name : '';
    const sId = res.studentId
      ? (res.studentId._id ? res.studentId._id.toString() : res.studentId.toString())
      : null;

    if (!studentName && res.studentId) {
      if (res.studentId.userId) {
        studentName = userNameMap.get(res.studentId.userId.toString()) || '';
      }
      if (!studentName && res.studentId.email) {
        studentName = userNameMap.get(res.studentId.email.toLowerCase().trim()) || '';
      }
    }

    if (!studentName) {
      studentName = 'Student';
    }

    const profileImage =
      (res.studentId && (res.studentId.profileImage || res.studentId.avatar)) || '';

    return {
      rank: index + 1,
      studentId: sId,
      studentName: studentName,
      name: studentName,
      score: res.score,
      totalMarks: res.totalMarks,
      correct: res.correctAnswers,
      correctAnswers: res.correctAnswers,
      wrong: res.wrongAnswers,
      wrongAnswers: res.wrongAnswers,
      unanswered: res.unanswered,
      percentage: res.percentage,
      timeTakenSeconds: res.timeTakenSeconds || 0,
      submittedAt: res.createdAt,
      submittedAtRaw: res.createdAt ? (res.createdAt.toISOString ? res.createdAt.toISOString() : String(res.createdAt)) : null,
      profileImage: profileImage,
      avatar: profileImage,
    };
  });

  return {
    exam: {
      id: exam._id.toString(),
      _id: exam._id.toString(),
      title: exam.title,
      courseId: 'unani',
      examType: 'grand_mock_test',
      totalQuestions: exam.totalQuestions || (Array.isArray(exam.questions) ? exam.questions.length : 0),
      duration: exam.durationMinutes || 0,
      durationMinutes: exam.durationMinutes || 0,
    },
    rankings,
  };
}

/**
 * Get exam history
 */
async function getHistory(examId, reqUser) {
  return await getResults(examId, reqUser);
}

/**
 * Get available Unani exams for student
 * Strictly queries the dedicated UnaniExam model/collection.
 */
async function getStudentAvailableExams(reqUser) {
  const results = [];

  try {
    const unaniExams = await UnaniExam.find({
      courseId: 'unani',
      status: { $nin: ['Draft', 'draft'] },
    })
      .select('_id title description examType courseId totalQuestions marksPerQuestion negativeMark negativeMarkPenalty durationMinutes status createdAt updatedAt questions')
      .sort({ createdAt: -1 })
      .lean();

    let studentId = null;
    if (reqUser) {
      try {
        studentId = await resolveStudentId(reqUser);
      } catch (e) {}
    }

    const attemptMap = new Map();
    if (studentId) {
      try {
        const studentResults = await UnaniExamResult.find({
          studentId: studentId,
          courseId: 'unani'
        }).sort({ createdAt: -1 }).lean();

        for (const res of studentResults) {
          if (!res.examId) continue;
          const eIdStr = res.examId.toString();
          if (!attemptMap.has(eIdStr)) {
            attemptMap.set(eIdStr, []);
          }
          attemptMap.get(eIdStr).push(res);
        }
      } catch (resErr) {
        console.warn('Error fetching Unani student results:', resErr.message);
      }
    }

    for (const exam of unaniExams) {
      const idStr = exam._id.toString();
      const examResults = (attemptMap.get(idStr) || []).sort((a, b) => {
        const aNum = typeof a.attemptNumber === 'number' ? a.attemptNumber : 0;
        const bNum = typeof b.attemptNumber === 'number' ? b.attemptNumber : 0;
        if (bNum !== aNum) return bNum - aNum;
        const bTime = new Date(b.createdAt || 0).getTime();
        const aTime = new Date(a.createdAt || 0).getTime();
        return bTime - aTime;
      });

      const totalAttempts = examResults.length;
      const latestAttempt = examResults[0] || null;
      let bestScore = null;
      let bestResult = null;
      if (totalAttempts > 0) {
        bestScore = Math.max(...examResults.map(r => (typeof r.score === 'number' ? r.score : 0)));
        bestResult = examResults.find(r => r.score === bestScore) || examResults[0];
      }
      const latestScore = latestAttempt ? latestAttempt.score : null;
      const isCompleted = totalAttempts > 0;
      const scoreValue = latestScore !== null ? latestScore : (bestScore ?? null);

      results.push({
        _id: idStr,
        id: idStr,
        title: exam.title,
        description: exam.description || '',
        courseId: 'unani',
        examType: exam.examType || 'grand_mock_test',
        totalQuestions: exam.totalQuestions || (Array.isArray(exam.questions) ? exam.questions.length : 0),
        duration: exam.durationMinutes || exam.duration || 0,
        durationMinutes: exam.durationMinutes || exam.duration || 0,
        marksPerQuestion: exam.marksPerQuestion || 1,
        negativeMark: exam.negativeMark || exam.negativeMarkPenalty || 0,
        status: isCompleted ? 'Completed' : (exam.status || 'Published'),
        attemptStatus: isCompleted ? 'completed' : 'not_started',
        hasAttempted: isCompleted,
        isCompleted: isCompleted,
        totalAttempts: totalAttempts,
        attempts: totalAttempts,
        total_attempts: totalAttempts,
        latestScore: latestScore,
        bestScore: bestScore,
        previousScore: scoreValue,
        score: scoreValue,
        resultId: latestAttempt ? latestAttempt._id : null,
        latestResultId: latestAttempt ? latestAttempt._id : null,
        bestResultId: bestResult ? bestResult._id : null,
        submittedAt: latestAttempt ? latestAttempt.createdAt : null,
        createdAt: exam.createdAt,
        updatedAt: exam.updatedAt,
      });
    }
  } catch (err) {
    console.error('Error fetching from UnaniExam:', err.message);
  }

  return results;
}

/**
 * Get Unani exam details & questions for student (with NO answer key/correctOption)
 * Strictly queries the dedicated UnaniExam model.
 */
async function getStudentExamById(examId, reqUser) {
  if (!examId || typeof examId !== 'string' || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true };
  }

  const exam = await UnaniExam.findOne({
    _id: examId,
    courseId: 'unani',
    status: { $nin: ['Draft', 'draft'] },
  }).lean();

  if (!exam) {
    return { notFound: true };
  }

  const sanitizedQuestions = (exam.questions || []).map((q) => {
    const qObj = q.toObject ? q.toObject() : { ...q };
    const qIdStr = qObj._id ? qObj._id.toString() : qObj.id;

    // SECURITY: CRITICAL - DO NOT expose answer key or correct options or explanations
    delete qObj.correctOption;
    delete qObj.correctAnswer;
    delete qObj.explanation;
    delete qObj.__v;

    return {
      _id: qIdStr,
      id: qIdStr,
      question: qObj.questionText || qObj.question || '',
      questionText: qObj.questionText || qObj.question || '',
      options: qObj.options || { A: '', B: '', C: '', D: '' },
      passage: qObj.passage || null,
      imageUrl: qObj.imageUrl || null,
      tableData: qObj.tableData || null,
    };
  });

  let completedCount = 0;
  if (reqUser) {
    try {
      const sId = await resolveStudentId(reqUser);
      if (sId) {
        completedCount = await UnaniExamResult.countDocuments({
          examId: exam._id,
          studentId: sId,
        });
      }
    } catch (e) {}
  }

  return {
    exam: {
      _id: exam._id.toString(),
      id: exam._id.toString(),
      title: exam.title,
      description: exam.description || '',
      courseId: 'unani',
      examType: exam.examType || 'grand_mock_test',
      totalQuestions: sanitizedQuestions.length,
      duration: exam.durationMinutes || exam.duration || 0,
      durationMinutes: exam.durationMinutes || exam.duration || 0,
      marksPerQuestion: exam.marksPerQuestion || 1,
      negativeMark: exam.negativeMark || exam.negativeMarkPenalty || 0,
      attemptNumber: completedCount + 1,
      totalAttempts: completedCount,
      isReattempt: completedCount > 0,
    },
    attemptNumber: completedCount + 1,
    totalAttempts: completedCount,
    isReattempt: completedCount > 0,
    questions: sanitizedQuestions,
  };
}

/**
 * Submit Unani exam answers for student with 100% server-side evaluation & duplicate prevention
 * Strictly operates on UnaniExam and UnaniExamResult.
 */
async function submitStudentExam(examId, reqUser, submissionData = {}) {
  if (!examId || typeof examId !== 'string' || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true };
  }

  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) {
    return { notFound: true };
  }

  const studentId = await resolveStudentId(reqUser);
  if (!studentId) {
    return { unauthenticated: true };
  }

  // Fetch previous submissions for student
  const previousResults = await UnaniExamResult.find({
    examId: exam._id,
    studentId: studentId,
  }).sort({ createdAt: -1 });

  // Idempotency: if rapid duplicate submission within 3 seconds, return the existing result
  if (previousResults.length > 0) {
    const latestAttempt = previousResults[0];
    const diffMs = Date.now() - new Date(latestAttempt.createdAt || latestAttempt.updatedAt).getTime();
    if (diffMs < 3000) {
      const bestScore = previousResults.reduce((max, r) => (r.score > max ? r.score : max), latestAttempt.score);
      return {
        resultId: latestAttempt._id.toString(),
        examId: exam._id.toString(),
        studentId: studentId.toString(),
        score: latestAttempt.score,
        correct: latestAttempt.correctAnswers,
        correctAnswers: latestAttempt.correctAnswers,
        wrong: latestAttempt.wrongAnswers,
        wrongAnswers: latestAttempt.wrongAnswers,
        unanswered: latestAttempt.unanswered,
        unansweredQuestions: latestAttempt.unanswered,
        attemptedQuestions: latestAttempt.correctAnswers + latestAttempt.wrongAnswers,
        totalMarks: latestAttempt.totalMarks,
        maximumScore: latestAttempt.totalMarks,
        percentage: latestAttempt.percentage,
        marksPerQuestion: Number(exam.marksPerQuestion) || 1,
        negativeMark: Number(exam.negativeMark || exam.negativeMarkPenalty || 0),
        totalQuestions: exam.questions ? exam.questions.length : 0,
        status: latestAttempt.status || 'Completed',
        timeTakenSeconds: latestAttempt.timeTakenSeconds || 0,
        timeTaken: latestAttempt.timeTakenSeconds || 0,
        attemptNumber: latestAttempt.attemptNumber || previousResults.length,
        totalAttempts: previousResults.length,
        attempts: previousResults.length,
        latestScore: latestAttempt.score,
        bestScore: bestScore,
        submittedAt: latestAttempt.createdAt,
      };
    }
  }

  const attemptNumber = previousResults.length + 1;

  // Normalize submitted answers input (supports map format and array format)
  const rawAnswers = submissionData.answers || submissionData.responses || {};
  const answersMap = {};

  if (Array.isArray(rawAnswers)) {
    rawAnswers.forEach((item) => {
      const qId = item.questionId || item.id || item._id;
      const ans = item.answer || item.selectedOption || item.option || item.val;
      if (qId && ans) {
        answersMap[qId.toString()] = String(ans).toUpperCase().trim();
      }
    });
  } else if (typeof rawAnswers === 'object' && rawAnswers !== null) {
    Object.keys(rawAnswers).forEach((qId) => {
      const val = rawAnswers[qId];
      if (typeof val === 'string') {
        answersMap[qId.toString()] = val.toUpperCase().trim();
      } else if (typeof val === 'object' && val !== null) {
        const ans = val.answer || val.selectedOption || val.option;
        if (ans) {
          answersMap[qId.toString()] = String(ans).toUpperCase().trim();
        }
      }
    });
  }

  const marksPerQuestion = Number(exam.marksPerQuestion) || 1;
  const penalty = Number(exam.negativeMark || exam.negativeMarkPenalty || 0);
  const totalQuestions = exam.questions ? exam.questions.length : 0;
  const totalMarks = totalQuestions * marksPerQuestion;

  let correctAnswers = 0;
  let wrongAnswers = 0;
  let unanswered = 0;
  let score = 0;

  const evaluatedAnswers = (exam.questions || []).map((question) => {
    const qIdStr = question._id.toString();
    const userAnsOption = answersMap[qIdStr] || null;
    const correctOption = String(question.correctOption || '').toUpperCase().trim();

    let isCorrect = false;
    let selectedOption = null;

    if (userAnsOption && ['A', 'B', 'C', 'D'].includes(userAnsOption)) {
      selectedOption = userAnsOption;
      if (userAnsOption === correctOption) {
        isCorrect = true;
        correctAnswers++;
        score += marksPerQuestion;
      } else {
        wrongAnswers++;
        score -= penalty;
      }
    } else {
      unanswered++;
    }

    return {
      questionId: question._id,
      selectedOption,
      correctOption,
      isCorrect,
    };
  });

  score = Math.max(0, Math.round(score * 100) / 100);
  const percentage = totalMarks > 0 ? Math.max(0, Math.round((score / totalMarks) * 100 * 100) / 100) : 0;

  let timeTakenSeconds = Number(submissionData.timeTakenSeconds ?? submissionData.timeTaken ?? 0);
  if (isNaN(timeTakenSeconds) || timeTakenSeconds < 0) {
    timeTakenSeconds = 0;
  }

  // Save exclusively to UnaniExamResult with distinct attemptNumber
  const newResult = new UnaniExamResult({
    studentId: studentId,
    examId: exam._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
    attemptNumber: attemptNumber,
    score: score,
    totalMarks: totalMarks,
    percentage: percentage,
    correctAnswers: correctAnswers,
    wrongAnswers: wrongAnswers,
    unanswered: unanswered,
    answers: evaluatedAnswers,
    status: 'Completed',
    timeTakenSeconds: timeTakenSeconds,
  });
  await newResult.save();

  const attemptedQuestions = correctAnswers + wrongAnswers;
  const bestScore = previousResults.reduce((max, r) => (r.score > max ? r.score : max), score);

  return {
    resultId: newResult._id.toString(),
    examId: exam._id.toString(),
    studentId: studentId.toString(),
    score: score,
    correct: correctAnswers,
    correctAnswers: correctAnswers,
    wrong: wrongAnswers,
    wrongAnswers: wrongAnswers,
    unanswered: unanswered,
    unansweredQuestions: unanswered,
    attemptedQuestions: attemptedQuestions,
    totalMarks: totalMarks,
    maximumScore: totalMarks,
    percentage: percentage,
    marksPerQuestion: marksPerQuestion,
    negativeMark: penalty,
    totalQuestions: totalQuestions,
    attemptNumber: attemptNumber,
    totalAttempts: attemptNumber,
    attempts: attemptNumber,
    latestScore: score,
    bestScore: bestScore,
    status: 'Completed',
    timeTakenSeconds: timeTakenSeconds,
    timeTaken: timeTakenSeconds,
    submittedAt: newResult.createdAt,
  };
}

/**
 * Get student's own calculated result after submission
 * Strictly queries UnaniExamResult.
 */
async function getStudentResultByExam(examId, reqUser) {
  if (!examId || typeof examId !== 'string' || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true };
  }

  const studentId = await resolveStudentId(reqUser);
  if (!studentId) {
    return { unauthenticated: true };
  }

  const result = await UnaniExamResult.findOne({
    examId: examId,
    studentId: studentId,
    courseId: 'unani',
  }).sort({ createdAt: -1 });

  if (!result) {
    return { notFound: true };
  }

  const exam = await UnaniExam.findById(result.examId).select('title marksPerQuestion negativeMark negativeMarkPenalty totalQuestions questions').lean();

  const totalQuestions = result.answers ? result.answers.length : (exam ? (exam.totalQuestions || (exam.questions ? exam.questions.length : 0)) : 0);
  const attemptedQuestions = (result.correctAnswers || 0) + (result.wrongAnswers || 0);

  const formattedKey = exam ? formatUnaniAnswerKey(exam, result) : null;
  const questionsList = formattedKey ? formattedKey.questions : [];

  return {
    resultId: result._id.toString(),
    examId: result.examId.toString(),
    studentId: studentId.toString(),
    examTitle: exam ? exam.title : '',
    score: result.score,
    correct: result.correctAnswers,
    correctAnswers: result.correctAnswers,
    wrong: result.wrongAnswers,
    wrongAnswers: result.wrongAnswers,
    unanswered: result.unanswered,
    unansweredQuestions: result.unanswered,
    attemptedQuestions: attemptedQuestions,
    totalMarks: result.totalMarks,
    maximumScore: result.totalMarks,
    percentage: result.percentage,
    marksPerQuestion: exam ? (exam.marksPerQuestion || 1) : 1,
    negativeMark: exam ? (exam.negativeMark || exam.negativeMarkPenalty || 0) : 0,
    totalQuestions: totalQuestions,
    attemptNumber: result.attemptNumber || 1,
    attempts: result.attemptNumber || 1,
    status: result.status || 'Completed',
    timeTakenSeconds: result.timeTakenSeconds || 0,
    timeTaken: result.timeTakenSeconds || 0,
    submittedAt: result.createdAt,
    answers: questionsList,
    questions: questionsList,
  };
}

/**
 * Format questions and student's answers into a comprehensive answer key payload
 */
function formatUnaniAnswerKey(exam, result = null) {
  const marksPerQuestion = Number(exam.marksPerQuestion) || 1;
  const negativeMark = Number(exam.negativeMark !== undefined && exam.negativeMark !== null ? exam.negativeMark : (exam.negativeMarkPenalty ?? 0));
  const questions = exam.questions || [];

  // Build a lookup map of student answers by questionId and by index
  const studentAnswersMap = new Map();
  if (result && Array.isArray(result.answers)) {
    result.answers.forEach((ans, index) => {
      if (ans.questionId) {
        studentAnswersMap.set(ans.questionId.toString(), ans);
      }
      studentAnswersMap.set(`idx_${index}`, ans);
    });
  }

  const formattedQuestions = questions.map((q, idx) => {
    const qIdStr = q._id ? q._id.toString() : '';
    const studentAns = (qIdStr ? studentAnswersMap.get(qIdStr) : null) || studentAnswersMap.get(`idx_${idx}`) || null;

    const options = q.options ? {
      A: q.options.A || '',
      B: q.options.B || '',
      C: q.options.C || '',
      D: q.options.D || '',
    } : { A: '', B: '', C: '', D: '' };

    const correctOption = (q.correctOption || '').toString().trim().toUpperCase();
    const correctAnswer = options[correctOption] || '';

    const selectedOption = studentAns && studentAns.selectedOption
      ? studentAns.selectedOption.toString().trim().toUpperCase()
      : null;
    const selectedAnswer = selectedOption && options[selectedOption] ? options[selectedOption] : null;

    const isAttempted = Boolean(selectedOption && ['A', 'B', 'C', 'D'].includes(selectedOption));
    let isCorrect = false;
    let marksAwarded = 0;

    if (studentAns !== null && studentAns !== undefined && studentAns.isCorrect !== undefined) {
      isCorrect = Boolean(studentAns.isCorrect);
    } else if (isAttempted) {
      isCorrect = (selectedOption === correctOption);
    }

    if (isAttempted) {
      marksAwarded = isCorrect ? marksPerQuestion : -negativeMark;
    } else {
      marksAwarded = 0;
    }

    return {
      questionId: q._id ? q._id.toString() : null,
      questionNumber: idx + 1,
      questionText: q.questionText || '',
      passage: q.passage || null,
      imageUrl: q.imageUrl || null,
      tableData: q.tableData || null,
      options: options,
      correctOption: correctOption,
      correctAnswer: correctAnswer,
      selectedOption: selectedOption,
      studentAnswer: selectedOption,
      studentSelectedOption: selectedOption,
      selectedAnswer: selectedAnswer,
      isCorrect: isCorrect,
      isAttempted: isAttempted,
      status: isAttempted ? (isCorrect ? 'correct' : 'wrong') : 'unanswered',
      marksAwarded: marksAwarded,
      marks: marksAwarded,
      explanation: q.explanation || '',
    };
  });

  const attemptedQuestions = result ? ((result.correctAnswers || 0) + (result.wrongAnswers || 0)) : 0;
  const totalQuestions = questions.length || exam.totalQuestions || 0;
  const totalMarks = result && result.totalMarks !== undefined ? result.totalMarks : (totalQuestions * marksPerQuestion);

  return {
    exam: {
      _id: exam._id ? exam._id.toString() : '',
      title: exam.title || '',
      courseId: exam.courseId || 'unani',
      examType: exam.examType || 'grand_mock_test',
      durationMinutes: exam.durationMinutes || 0,
      totalQuestions: totalQuestions,
      marksPerQuestion: marksPerQuestion,
      negativeMark: negativeMark,
    },
    examId: exam._id ? exam._id.toString() : '',
    examTitle: exam.title || '',
    resultId: result && result._id ? result._id.toString() : null,
    studentId: result && result.studentId ? (result.studentId._id ? result.studentId._id.toString() : result.studentId.toString()) : null,
    status: result ? (result.status || 'Completed') : (exam.status || 'Published'),
    score: result ? result.score : 0,
    totalMarks: totalMarks,
    percentage: result ? result.percentage : 0,
    correctAnswers: result ? (result.correctAnswers || 0) : 0,
    wrongAnswers: result ? (result.wrongAnswers || 0) : 0,
    unanswered: result ? (result.unanswered || 0) : totalQuestions,
    attemptedQuestions: attemptedQuestions,
    totalQuestions: totalQuestions,
    marksPerQuestion: marksPerQuestion,
    negativeMark: negativeMark,
    summary: {
      score: result ? result.score : 0,
      totalMarks: totalMarks,
      percentage: result ? result.percentage : 0,
      correctAnswers: result ? (result.correctAnswers || 0) : 0,
      wrongAnswers: result ? (result.wrongAnswers || 0) : 0,
      unanswered: result ? (result.unanswered || 0) : totalQuestions,
      attemptedQuestions: attemptedQuestions,
      totalQuestions: totalQuestions,
      marksPerQuestion: marksPerQuestion,
      negativeMark: negativeMark,
      timeTakenSeconds: result ? (result.timeTakenSeconds || 0) : 0,
      submittedAt: result ? result.createdAt : null,
    },
    questions: formattedQuestions,
    answers: formattedQuestions,
  };
}

/**
 * Retrieve Answer Key for student's completed exam attempt
 */
async function getStudentExamAnswerKey(examId, reqUser, resultId = null) {
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true, message: 'Invalid or missing Exam ID.' };
  }

  let exam = await UnaniExam.findOne({
    _id: examId,
    $or: [
      { courseId: { $in: ['unani', 'UNANI', /^unani$/i] } },
      { courseId: { $exists: false } },
      { courseId: null },
    ],
  }).lean();

  if (!exam && mongoose.connection?.readyState === 1) {
    let Exam;
    try { Exam = mongoose.models.Exam || require('../../../../models/Exam'); } catch (e) {}
    if (Exam) {
      exam = await Exam.findById(examId).lean();
    }
  }

  if (!exam) {
    return { notFound: true, message: 'Unani exam not found.' };
  }

  const userRole = String(reqUser?.role || '').toLowerCase().trim();
  const isAdmin = ['admin', 'superadmin'].includes(userRole);

  let result = null;

  if (resultId) {
    if (!mongoose.Types.ObjectId.isValid(resultId)) {
      return { notFound: true, message: 'Invalid or missing Result ID.' };
    }
    let existingResult = await UnaniExamResult.findById(resultId).lean();
    if (!existingResult && mongoose.connection?.readyState === 1) {
      let TestResult;
      try { TestResult = mongoose.models.TestResult || require('../../../common/models/testResult.model'); } catch (e) {}
      if (TestResult) {
        existingResult = await TestResult.findById(resultId).lean();
      }
    }
    if (!existingResult) {
      return { notFound: true, message: 'Unani exam result not found.' };
    }
    const resultExamId = existingResult.examId ? existingResult.examId.toString() : '';
    if (resultExamId !== exam._id.toString()) {
      return { notFound: true, message: 'Unani exam result does not belong to this exam.' };
    }
    result = existingResult;

    if (!isAdmin) {
      const studentId = await resolveStudentId(reqUser);
      let candidateIds = [];
      if (mongoose.connection?.readyState === 1) {
        try {
          const { getStudentCandidateIds } = require('../../../../utils/examAttemptHelper');
          candidateIds = (await getStudentCandidateIds(reqUser)).map((id) => id.toString());
        } catch (e) {}
      }
      if (studentId && !candidateIds.includes(studentId.toString())) {
        candidateIds.push(studentId.toString());
      }
      if (reqUser?.id && !candidateIds.includes(reqUser.id.toString())) {
        candidateIds.push(reqUser.id.toString());
      }
      if (reqUser?.studentId && !candidateIds.includes(reqUser.studentId.toString())) {
        candidateIds.push(reqUser.studentId.toString());
      }
      if (reqUser?.userId && !candidateIds.includes(reqUser.userId.toString())) {
        candidateIds.push(reqUser.userId.toString());
      }

      const resStudentId = result.studentId?._id ? result.studentId._id.toString() : (result.studentId ? result.studentId.toString() : '');
      if (!resStudentId || !candidateIds.includes(resStudentId)) {
        return { forbidden: true, message: "Forbidden: You are not authorized to view another student's answer key." };
      }
      if (!['Completed', 'Attempted'].includes(result.status)) {
        return { forbidden: true, message: 'A completed attempt is required to view this answer key.' };
      }
    }
  } else if (!isAdmin) {
    const studentId = await resolveStudentId(reqUser);
    if (!studentId) {
      return { unauthenticated: true, message: 'Student identity could not be resolved.' };
    }

    result = await UnaniExamResult.findOne({
      examId: exam._id,
      studentId: studentId,
      status: { $in: ['Completed', 'Attempted'] },
    }).sort({ createdAt: -1 }).lean();

    if (!result && mongoose.connection?.readyState === 1) {
      let TestResult;
      try { TestResult = mongoose.models.TestResult || require('../../../common/models/testResult.model'); } catch (e) {}
      if (TestResult) {
        result = await TestResult.findOne({
          examId: exam._id,
          studentId: studentId,
          status: { $in: ['Completed', 'Attempted'] },
        }).sort({ createdAt: -1 }).lean();
      }
    }

    if (!result) {
      return { forbidden: true, message: 'A completed attempt is required to view this answer key.' };
    }
  }

  return {
    success: true,
    exam,
    result,
    data: formatUnaniAnswerKey(exam, result),
  };
}

/**
 * Retrieve Answer Key for Admin (master answer key or specific student evaluation)
 */
async function getAdminExamAnswerKey(examId, reqUser, query = {}) {
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true, message: 'Invalid or missing Exam ID.' };
  }

  let exam = await UnaniExam.findOne({
    _id: examId,
    $or: [
      { courseId: { $in: ['unani', 'UNANI', /^unani$/i] } },
      { courseId: { $exists: false } },
      { courseId: null },
    ],
  }).lean();

  if (!exam && mongoose.connection?.readyState === 1) {
    let Exam;
    try { Exam = mongoose.models.Exam || require('../../../../models/Exam'); } catch (e) {}
    if (Exam) {
      exam = await Exam.findById(examId).lean();
    }
  }

  if (!exam) {
    return { notFound: true, message: 'Unani exam not found.' };
  }

  let result = null;
  const resultId = query.resultId;
  const studentId = query.studentId;

  if (resultId) {
    if (!mongoose.Types.ObjectId.isValid(resultId)) {
      return { notFound: true, message: 'Invalid or missing Result ID.' };
    }
    let existingResult = await UnaniExamResult.findById(resultId).lean();
    if (!existingResult && mongoose.connection?.readyState === 1) {
      let TestResult;
      try { TestResult = mongoose.models.TestResult || require('../../../common/models/testResult.model'); } catch (e) {}
      if (TestResult) {
        existingResult = await TestResult.findById(resultId).lean();
      }
    }
    if (!existingResult) {
      return { notFound: true, message: 'Unani exam result not found.' };
    }
    const resultExamId = existingResult.examId ? existingResult.examId.toString() : '';
    if (resultExamId !== exam._id.toString()) {
      return { notFound: true, message: 'Unani exam result does not belong to this exam.' };
    }
    result = existingResult;
  } else if (studentId) {
    let sObjectId = mongoose.Types.ObjectId.isValid(studentId) ? new mongoose.Types.ObjectId(studentId) : null;
    result = await UnaniExamResult.findOne({
      examId: exam._id,
      studentId: sObjectId || studentId,
    }).sort({ createdAt: -1 }).lean();
    if (!result && mongoose.connection?.readyState === 1) {
      let TestResult;
      try { TestResult = mongoose.models.TestResult || require('../../../common/models/testResult.model'); } catch (e) {}
      if (TestResult) {
        result = await TestResult.findOne({
          examId: exam._id,
          studentId: sObjectId || studentId,
        }).sort({ createdAt: -1 }).lean();
      }
    }
  }

  return {
    success: true,
    exam,
    result,
    data: formatUnaniAnswerKey(exam, result),
  };
}

/**
 * Bulk update or set answer key for an Unani exam (Admin only)
 */
async function updateExamAnswerKey(examId, keyData) {
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return { error: 'Invalid Exam ID.', status: 400 };
  }

  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) {
    return { error: 'Unani exam not found.', status: 404 };
  }

  let items = [];
  if (Array.isArray(keyData)) {
    items = keyData;
  } else if (Array.isArray(keyData?.answerKey)) {
    items = keyData.answerKey;
  } else if (Array.isArray(keyData?.questions)) {
    items = keyData.questions;
  } else if (keyData?.answers && typeof keyData.answers === 'object') {
    items = Object.keys(keyData.answers).map((qId) => ({
      questionId: qId,
      correctOption: keyData.answers[qId],
    }));
  }

  if (items.length === 0) {
    return { error: 'No answer key items provided.', status: 400 };
  }

  let updatedCount = 0;
  for (const item of items) {
    const qId = item.questionId || item.id || item._id;
    const rawOption = (item.correctOption || item.answer || item.correctAnswer || '').toString().trim().toUpperCase();

    if (!['A', 'B', 'C', 'D'].includes(rawOption)) {
      continue;
    }

    let question = null;
    if (qId && mongoose.Types.ObjectId.isValid(qId)) {
      question = exam.questions.id(qId);
    }
    if (!question && item.questionNumber && exam.questions[item.questionNumber - 1]) {
      question = exam.questions[item.questionNumber - 1];
    }

    if (question) {
      question.correctOption = rawOption;
      if (item.explanation !== undefined) {
        question.explanation = String(item.explanation).trim();
      }
      updatedCount++;
    }
  }

  await exam.save();

  return {
    success: true,
    updatedCount,
    totalQuestions: exam.questions.length,
    data: formatUnaniAnswerKey(exam.toObject(), null),
  };
}

/**
 * Generate Watermarked Answer Key PDF for Unani Exam
 */
function generateUnaniAnswerKeyPDF(exam, user = {}, result = null) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 25, left: 40, right: 40 },
        bufferPages: true,
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      doc.font('Helvetica');
      doc.font('Helvetica-Bold');
      doc.font('Helvetica-Oblique');

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
      const BOTTOM_MARGIN_THRESHOLD = PAGE_HEIGHT - 75;

      // Header Section
      doc.fillColor('#1A365D')
         .fontSize(22)
         .font('Helvetica-Bold')
         .text('WHITE COAT ACADEMY', MARGIN, MARGIN, { align: 'center' });

      doc.moveDown(0.2);
      doc.fillColor('#2B6CB0')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text('UNANI EXAM - OFFICIAL ANSWER KEY & EVALUATION', { align: 'center' });

      doc.moveDown(0.5);

      // Divider Line
      doc.strokeColor('#CBD5E0')
         .lineWidth(1)
         .moveTo(MARGIN, doc.y)
         .lineTo(PAGE_WIDTH - MARGIN, doc.y)
         .stroke();

      doc.moveDown(0.6);

      // Metadata Box
      const metaStartY = doc.y;
      const hasResult = Boolean(result);
      const metaHeight = hasResult ? 88 : 70;

      doc.rect(MARGIN, metaStartY, CONTENT_WIDTH, metaHeight)
         .fillAndStroke('#EDF2F7', '#CBD5E0');

      doc.fillColor('#2D3748')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(`Exam Title: ${exam.title || 'Unani Mock Test'}`, MARGIN + 10, metaStartY + 8, { width: CONTENT_WIDTH - 20 });

      const totalQs = (exam.questions && exam.questions.length) || exam.totalQuestions || 0;
      const marksPerQ = Number(exam.marksPerQuestion) || 1;
      const negMark = Number(exam.negativeMark !== undefined && exam.negativeMark !== null ? exam.negativeMark : (exam.negativeMarkPenalty ?? 0));
      const duration = exam.durationMinutes ? `${exam.durationMinutes} mins` : 'N/A';

      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('#4A5568')
         .text(`Total Questions: ${totalQs}   |   Marks per Question: ${marksPerQ}   |   Negative Mark: -${negMark}   |   Duration: ${duration}`, MARGIN + 10, metaStartY + 26);

      const userName = (user && user.name) || 'Student';
      const userEmail = (user && user.email) || 'N/A';
      const userId = (user && (user.id || user.userId || user.studentId)) || 'N/A';
      const issueDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

      doc.text(`Issued To: ${userName} (${userEmail})   |   ID: ${userId}   |   Generated: ${issueDate}`, MARGIN + 10, metaStartY + 44);

      if (hasResult) {
        const score = result.score ?? 0;
        const totalMarks = result.totalMarks ?? (totalQs * marksPerQ);
        const pct = result.percentage ?? (totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0);
        const correct = result.correctAnswers ?? 0;
        const wrong = result.wrongAnswers ?? 0;
        const unanswered = result.unanswered ?? 0;

        doc.fillColor('#1A365D')
           .font('Helvetica-Bold')
           .text(`Evaluation Summary: Score: ${score} / ${totalMarks} (${pct}%)   |   Correct: ${correct}   |   Wrong: ${wrong}   |   Unanswered: ${unanswered}`, MARGIN + 10, metaStartY + 64);
      }

      doc.y = metaStartY + metaHeight + 15;

      // Questions & Answers Section
      const questions = exam.questions || [];

      // Build student answer lookup
      const studentAnswersMap = new Map();
      if (result && Array.isArray(result.answers)) {
        result.answers.forEach((ans, index) => {
          if (ans.questionId) {
            studentAnswersMap.set(ans.questionId.toString(), ans);
          }
          studentAnswersMap.set(`idx_${index}`, ans);
        });
      }

      if (questions.length === 0) {
        doc.fillColor('#718096')
           .fontSize(11)
           .font('Helvetica-Oblique')
           .text('No questions found for this exam.', MARGIN, doc.y);
      } else {
        questions.forEach((q, index) => {
          const correctKey = (q.correctOption || '').toString().trim().toUpperCase();
          const options = q.options || {};
          const explanation = (q.explanation || '').trim();

          const qIdStr = q._id ? q._id.toString() : '';
          const studentAns = (qIdStr ? studentAnswersMap.get(qIdStr) : null) || studentAnswersMap.get(`idx_${index}`) || null;
          const studentOption = studentAns && studentAns.selectedOption ? studentAns.selectedOption.toString().trim().toUpperCase() : null;
          const isStudentAttempted = Boolean(studentOption && ['A', 'B', 'C', 'D'].includes(studentOption));
          const isStudentCorrect = studentAns ? Boolean(studentAns.isCorrect) : (isStudentAttempted && studentOption === correctKey);

          // Page break check
          if (doc.y > BOTTOM_MARGIN_THRESHOLD) {
            doc.addPage();
            doc.y = MARGIN + 25;
          }

          // Question Number & Text
          doc.fillColor('#1A202C')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(`Q${index + 1}. ${q.questionText || ''}`, MARGIN, doc.y, { width: CONTENT_WIDTH });

          doc.moveDown(0.2);

          // Optional Passage
          if (q.passage) {
            doc.fillColor('#2D3748')
               .fontSize(9)
               .font('Helvetica-Oblique')
               .text(`Passage: ${q.passage}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.2);
          }

          // Optional Image URL
          if (q.imageUrl) {
            doc.fillColor('#4A5568')
               .fontSize(8.5)
               .font('Helvetica')
               .text(`[Image: ${q.imageUrl}]`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.2);
          }

          // Optional Table Data
          if (q.tableData) {
            const tableStr = typeof q.tableData === 'string' ? q.tableData : JSON.stringify(q.tableData);
            doc.fillColor('#4A5568')
               .fontSize(8.5)
               .font('Helvetica-Bold')
               .text(`[Table Data]: ${tableStr}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.2);
          }

          // Options A, B, C, D
          ['A', 'B', 'C', 'D'].forEach((key) => {
            const optionText = options[key];
            if (optionText !== undefined && optionText !== null && String(optionText).trim() !== '') {
              const isCorrectOption = (key === correctKey);
              const isSelectedOption = (studentOption === key);

              if (isCorrectOption && isSelectedOption) {
                doc.fillColor('#22543D')
                   .fontSize(9.5)
                   .font('Helvetica-Bold')
                   .text(`   [✓] Option ${key}: ${optionText}   (CORRECT - YOUR ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else if (isCorrectOption) {
                doc.fillColor('#22543D')
                   .fontSize(9.5)
                   .font('Helvetica-Bold')
                   .text(`   [✓] Option ${key}: ${optionText}   (CORRECT ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else if (isSelectedOption) {
                doc.fillColor('#C53030')
                   .fontSize(9.5)
                   .font('Helvetica-Bold')
                   .text(`   [✗] Option ${key}: ${optionText}   (YOUR ANSWER - INCORRECT)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else {
                doc.fillColor('#4A5568')
                   .fontSize(9.5)
                   .font('Helvetica')
                   .text(`   [  ] Option ${key}: ${optionText}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              }
              doc.moveDown(0.18);
            }
          });

          // Result line for this question if result present
          if (hasResult) {
            if (isStudentAttempted) {
              if (isStudentCorrect) {
                doc.fillColor('#22543D')
                   .fontSize(8.5)
                   .font('Helvetica-Bold')
                   .text(`   Evaluation: Correct (+${marksPerQ} mark${marksPerQ === 1 ? '' : 's'})`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else {
                doc.fillColor('#C53030')
                   .fontSize(8.5)
                   .font('Helvetica-Bold')
                   .text(`   Evaluation: Incorrect (-${negMark} mark${negMark === 1 ? '' : 's'})`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              }
            } else {
              doc.fillColor('#B7791F')
                 .fontSize(8.5)
                 .font('Helvetica-Oblique')
                 .text('   Evaluation: Not Attempted / Skipped (0 marks)', MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            }
            doc.moveDown(0.15);
          }

          // Optional Explanation
          if (explanation) {
            doc.fillColor('#2B6CB0')
               .fontSize(8.5)
               .font('Helvetica-Oblique')
               .text(`   Explanation: ${explanation}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.18);
          }

          // Space between questions
          if (index < questions.length - 1) {
            doc.moveDown(0.35);
          }
        });
      }

      // Post-Processing Loop: Headers, Watermarks & Footers on EVERY Page
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);

        // 1. Running Header for Page 2+
        if (i > 0) {
          doc.save();
          doc.fillColor('#1A365D')
             .fontSize(9)
             .font('Helvetica-Bold')
             .text('WHITE COAT ACADEMY — UNANI EXAM ANSWER KEY', MARGIN, 20, { width: CONTENT_WIDTH, align: 'left' });

          doc.fillColor('#4A5568')
             .fontSize(8)
             .font('Helvetica')
             .text(`${exam.title || 'Unani Mock Test'}   |   Issued To: ${userName}`, MARGIN, 20, { width: CONTENT_WIDTH, align: 'right' });

          doc.strokeColor('#E2E8F0')
             .lineWidth(0.75)
             .moveTo(MARGIN, 34)
             .lineTo(PAGE_WIDTH - MARGIN, 34)
             .stroke();
          doc.restore();
        }

        // 2. Centered Logo Background Watermark
        buildPdfWatermark(doc, PAGE_WIDTH, PAGE_HEIGHT);

        // 3. Running Footer on ALL pages
        doc.save();
        doc.opacity(0.75);
        doc.fillColor('#718096');
        doc.fontSize(8);
        doc.font('Helvetica');
        doc.text(
          `White Coat Academy — Confidential & Watermarked Unani Answer Key   |   Page ${i + 1} of ${totalPages}`,
          MARGIN,
          805,
          { width: CONTENT_WIDTH, align: 'center' }
        );
        doc.restore();
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Update student rank profile image
 */
async function updateRankImage(examId, studentId, imageUrl) {
  const finalUrl = (imageUrl || '').trim();
  if (!studentId) {
    return { error: 'studentId is required to update student rank profile image', status: 400 };
  }
  if (!finalUrl) {
    return { error: 'A valid imageUrl/profileImage is required', status: 400 };
  }

  let User;
  try { User = require('../../../../models/User'); } catch (e) {}

  let updatedStudent = null;
  if (Student) {
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
  }

  if (User) {
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      await User.findByIdAndUpdate(
        studentId,
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }
    if (updatedStudent && updatedStudent.userId) {
      await User.findByIdAndUpdate(
        updatedStudent.userId,
        { profileImage: finalUrl, avatar: finalUrl },
        { new: true }
      );
    }
  }

  return {
    studentId,
    profileImage: finalUrl,
    imageUrl: finalUrl,
    avatar: finalUrl,
  };
}

/**
 * Delete student rank profile image
 */
async function deleteRankImage(examId, studentId) {
  if (!studentId) {
    return { error: 'studentId is required to delete student rank profile image', status: 400 };
  }

  let User;
  try { User = require('../../../../models/User'); } catch (e) {}

  if (Student) {
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      await Student.findByIdAndUpdate(studentId, { profileImage: '', avatar: '' });
    }
    await Student.findOneAndUpdate(
      { $or: [{ studentId }, { email: studentId }, { userId: studentId }] },
      { profileImage: '', avatar: '' }
    );
  }

  if (User) {
    if (mongoose.Types.ObjectId.isValid(studentId)) {
      await User.findByIdAndUpdate(studentId, { profileImage: '', avatar: '' });
    }
  }

  return {
    studentId,
    profileImage: null,
  };
}


/**
 * Check reattempt and attempt eligibility for an Unani exam
 */
async function checkReattemptEligibility(examId, reqUser) {
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return { notFound: true, message: 'Invalid Exam ID format' };
  }
  const exam = await UnaniExam.findOne({ _id: examId, courseId: 'unani' });
  if (!exam) {
    return { notFound: true, message: 'Unani exam not found' };
  }
  const studentId = await resolveStudentId(reqUser);
  if (!studentId) {
    return { unauthorized: true, message: 'Authenticated student not found' };
  }
  const previousResults = await UnaniExamResult.find({
    examId: exam._id,
    studentId: studentId,
  }).sort({ attemptNumber: -1, createdAt: -1 }).lean();

  const totalAttempts = previousResults.length;
  const isReattempt = totalAttempts > 0;
  const maxAttempts = Number(exam.maxAttempts || exam.attemptLimit) || 0;

  if (maxAttempts > 0 && totalAttempts >= maxAttempts) {
    return {
      eligible: false,
      isReattempt,
      totalAttempts,
      maxAttempts,
      attemptsRemaining: 0,
      latestScore: previousResults[0]?.score ?? null,
      bestScore: previousResults.length > 0 ? Math.max(...previousResults.map(r => (typeof r.score === 'number' ? r.score : 0))) : null,
      message: `Maximum attempts (${maxAttempts}) reached for this exam.`,
      reason: `Maximum attempts (${maxAttempts}) reached for this exam.`,
    };
  }

  const attemptsRemaining = maxAttempts > 0 ? Math.max(0, maxAttempts - totalAttempts) : null;
  const latestScore = previousResults[0]?.score ?? null;
  const bestScore = previousResults.length > 0 ? Math.max(...previousResults.map(r => (typeof r.score === 'number' ? r.score : 0))) : null;

  return {
    eligible: true,
    isReattempt,
    totalAttempts,
    maxAttempts: maxAttempts > 0 ? maxAttempts : null,
    attemptsRemaining,
    latestScore,
    bestScore,
    message: isReattempt ? 'Eligible for reattempt.' : 'Eligible for first attempt.',
    reason: null,
  };
}

module.exports = {
  createExam,
  getAllExams,
  getExamById,
  updateExam,
  deleteExam,
  addQuestion,
  getQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  addQuestionsBulk,
  startExam,
  submitExam,
  getResults,
  getResultById,
  getRank,
  getHistory,
  getUnaniTestHistory,
  getUnaniTestHistoryById,
  deleteUnaniTest,
  getStudentAvailableExams,
  getStudentExamById,
  submitStudentExam,
  getStudentResultByExam,
  formatUnaniAnswerKey,
  getStudentExamAnswerKey,
  getAdminExamAnswerKey,
  updateExamAnswerKey,
  generateUnaniAnswerKeyPDF,
  updateRankImage,
  deleteRankImage,
  checkReattemptEligibility,
};
