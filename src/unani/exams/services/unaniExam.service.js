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
 * Get exam leaderboard / ranking
 */
async function getRank(examId) {
  if (!mongoose.Types.ObjectId.isValid(examId)) return [];

  const results = await UnaniExamResult.find({ examId, courseId: 'unani' })
    .populate('studentId', 'name email')
    .sort({ score: -1, percentage: -1, createdAt: 1 });

  return results.map((res, index) => ({
    rank: index + 1,
    studentId: res.studentId ? (res.studentId._id ? res.studentId._id.toString() : res.studentId.toString()) : null,
    studentName: res.studentId ? res.studentId.name : 'Student',
    score: res.score,
    totalMarks: res.totalMarks,
    percentage: res.percentage,
    correctAnswers: res.correctAnswers,
    wrongAnswers: res.wrongAnswers,
    submittedAt: res.createdAt,
  }));
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
};
