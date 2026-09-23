const mongoose = require('mongoose');

/**
 * Resolves all candidate ObjectIds associated with an authenticated student.
 * Resolves user._id, student._id, user.userId, and matches by email across User and Student models.
 */
async function getStudentCandidateIds(user) {
  if (!user) return [];
  const ids = new Set();

  if (user.id) ids.add(user.id.toString());
  if (user._id) ids.add(user._id.toString());
  if (user.userId) ids.add(user.userId.toString());
  if (user.studentId) ids.add(user.studentId.toString());

  let Student;
  let User;
  try { Student = mongoose.models.Student || require('../models/Student'); } catch (e) {}
  try { User = mongoose.models.User || require('../models/User'); } catch (e) {}

  const studentOr = [];
  ids.forEach((id) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
      studentOr.push({ _id: new mongoose.Types.ObjectId(id) });
      studentOr.push({ userId: new mongoose.Types.ObjectId(id) });
    }
  });
  if (user.email) {
    studentOr.push({ email: user.email.toLowerCase().trim() });
  }

  if (studentOr.length > 0 && Student) {
    try {
      const studentDocs = await Student.find({ $or: studentOr }).lean();
      for (const s of studentDocs) {
        if (s._id) ids.add(s._id.toString());
        if (s.userId) ids.add(s.userId.toString());
      }
    } catch (e) {}
  }

  const userOr = [];
  ids.forEach((id) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
      userOr.push({ _id: new mongoose.Types.ObjectId(id) });
    }
  });
  if (user.email) {
    userOr.push({ email: user.email.toLowerCase().trim() });
  }

  if (userOr.length > 0 && User) {
    try {
      const userDocs = await User.find({ $or: userOr }).lean();
      for (const u of userDocs) {
        if (u._id) ids.add(u._id.toString());
      }
    } catch (e) {}
  }

  return Array.from(ids)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

/**
 * Given candidate student ObjectIds and an optional list of exam ObjectIds,
 * fetches TestResult records from MongoDB and groups them by examId string.
 */
async function getStudentExamAttemptMap(candidateIds, examIds = null) {
  const attemptMap = new Map();
  if (!candidateIds || candidateIds.length === 0) return attemptMap;

  let TestResult;
  try {
    TestResult = mongoose.models.TestResult || require('../src/common/models/testResult.model');
  } catch (e) {}
  if (!TestResult) return attemptMap;

  const filter = { studentId: { $in: candidateIds } };
  if (examIds && examIds.length > 0) {
    const validExamIds = examIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (validExamIds.length > 0) {
      filter.examId = { $in: validExamIds };
    }
  }

  const results = await TestResult.find(filter).sort({ createdAt: -1 }).lean();

  for (const result of results) {
    if (!result.examId) continue;
    const examIdStr = result.examId.toString();
    if (!attemptMap.has(examIdStr)) {
      attemptMap.set(examIdStr, []);
    }
    attemptMap.get(examIdStr).push(result);
  }

  return attemptMap;
}

/**
 * Computes unified attempt metrics for an exam given its student test results.
 */
function computeExamAttemptMetrics(exam, resultsForExam = []) {
  const latestResult = resultsForExam[0] || null;
  const completedResult = resultsForExam.find((r) =>
    r.status === 'Completed' ||
    r.status === 'Attempted' ||
    (r.score !== undefined && r.score !== null && r.status !== 'In Progress')
  ) || null;

  const activeResult = completedResult || latestResult;

  let status = 'Not Started';
  let attemptStatus = 'not_started';
  let hasAttempted = false;
  let isCompleted = false;

  if (activeResult) {
    hasAttempted = true;
    if (
      completedResult ||
      activeResult.status === 'Completed' ||
      activeResult.status === 'Attempted' ||
      (activeResult.score !== undefined && activeResult.score !== null && activeResult.status !== 'In Progress')
    ) {
      status = 'Completed';
      attemptStatus = 'completed';
      isCompleted = true;
    } else if (activeResult.status === 'In Progress') {
      status = 'In Progress';
      attemptStatus = 'in_progress';
      isCompleted = false;
    }
  }

  const marksPerQ = exam.marksPerQuestion ?? 1;
  const totalQ = exam.totalQuestions ?? (Array.isArray(exam.questions) ? exam.questions.length : 0);
  const defaultTotalMarks = totalQ * marksPerQ;

  const scoreValue = completedResult
    ? completedResult.score
    : (activeResult && activeResult.status !== 'In Progress' ? activeResult.score : null);

  return {
    status,
    attemptStatus,
    hasAttempted,
    isCompleted,
    previousScore: scoreValue,
    score: scoreValue,
    totalMarks: activeResult && activeResult.totalMarks ? activeResult.totalMarks : defaultTotalMarks,
    lastAttemptedAt: activeResult ? (activeResult.createdAt || activeResult.updatedAt) : null,
    submittedAt: completedResult ? (completedResult.createdAt || completedResult.updatedAt) : null,
    resultId: activeResult ? activeResult._id : null,
  };
}

module.exports = {
  getStudentCandidateIds,
  getStudentExamAttemptMap,
  computeExamAttemptMetrics,
};
