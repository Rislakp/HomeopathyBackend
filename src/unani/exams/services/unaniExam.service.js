const mongoose = require('mongoose');
const UnaniExam = require('../models/unaniExam.model');
const UnaniExamResult = require('../models/unaniExamResult.model');
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
async function getAllExams(queryFilter = {}) {
  const filter = { courseId: 'unani', examType: 'grand_mock_test', ...queryFilter };
  return await UnaniExam.find(filter).sort({ createdAt: -1 });
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

  const result = new UnaniExamResult({
    studentId: studentId,
    examId: exam._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
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
  return result;
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
    return result;
  }

  const studentId = await resolveStudentId(reqUser);
  if (!studentId || result.studentId._id.toString() !== studentId.toString()) {
    return { forbidden: true };
  }

  return result;
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
    .populate('studentId', 'name email phone userId')
    .sort({ score: -1, percentage: -1, createdAt: 1 });

  let User;
  try {
    User = require('../../../../models/User');
  } catch (e) {}

  const rankings = await Promise.all(
    results.map(async (res, index) => {
      let studentName = res.studentId ? res.studentId.name : '';
      const sId = res.studentId
        ? (res.studentId._id ? res.studentId._id.toString() : res.studentId.toString())
        : null;

      if (!studentName && res.studentId && User) {
        try {
          const userDoc =
            (res.studentId.userId && (await User.findById(res.studentId.userId))) ||
            (res.studentId.email && (await User.findOne({ email: res.studentId.email.toLowerCase().trim() })));
          if (userDoc) {
            studentName = userDoc.name || '';
          }
        } catch (e) {}
      }

      if (!studentName) {
        studentName = 'Student';
      }

      return {
        rank: index + 1,
        studentId: sId,
        studentName: studentName,
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
      };
    })
  );

  return {
    exam: {
      id: exam._id.toString(),
      _id: exam._id.toString(),
      title: exam.title,
      courseId: 'unani',
      examType: 'grand_mock_test',
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
};
