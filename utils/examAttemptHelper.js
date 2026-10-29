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
 * Supports multiple attempts / reattempts, tracking:
 * - totalAttempts: count of completed attempts
 * - latestScore: score of latest completed attempt
 * - bestScore: highest score across all completed attempts
 * - inProgressAttempt: active uncompleted attempt
 */
function computeExamAttemptMetrics(exam, resultsForExam = []) {
  // Filter all completed attempts and sort by attemptNumber descending then timestamp descending
  const completedResults = resultsForExam
    .filter((r) =>
      r.status === 'Completed' ||
      r.status === 'Attempted' ||
      (r.score !== undefined && r.score !== null && r.status !== 'In Progress')
    )
    .sort((a, b) => {
      const aNum = typeof a.attemptNumber === 'number' ? a.attemptNumber : 0;
      const bNum = typeof b.attemptNumber === 'number' ? b.attemptNumber : 0;
      if (bNum !== aNum) return bNum - aNum;
      const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
      return bTime - aTime;
    });

  const inProgressAttempt = resultsForExam.find((r) => r.status === 'In Progress') || null;

  // Latest completed result (first in list because sorted by createdAt: -1)
  const latestCompletedResult = completedResults[0] || null;

  // Calculate best score and best result across all valid completed attempts
  let bestScore = null;
  let bestResult = null;
  if (completedResults.length > 0) {
    bestScore = Math.max(...completedResults.map((r) => (typeof r.score === 'number' ? r.score : 0)));
    bestResult = completedResults.find((r) => r.score === bestScore) || completedResults[0];
  }

  const latestScore = latestCompletedResult ? latestCompletedResult.score : null;
  const totalAttempts = completedResults.length;

  let status = 'Not Started';
  let attemptStatus = 'not_started';
  let hasAttempted = false;
  let isCompleted = false;

  if (inProgressAttempt) {
    status = 'In Progress';
    attemptStatus = 'in_progress';
    hasAttempted = true;
    isCompleted = completedResults.length > 0;
  } else if (completedResults.length > 0) {
    status = 'Completed';
    attemptStatus = 'completed';
    hasAttempted = true;
    isCompleted = true;
  }

  const marksPerQ = exam.marksPerQuestion ?? 1;
  const totalQ = exam.totalQuestions ?? (Array.isArray(exam.questions) ? exam.questions.length : 0);
  const defaultTotalMarks = totalQ * marksPerQ;

  const primaryResult = latestCompletedResult || inProgressAttempt || resultsForExam[0] || null;
  const scoreValue = latestScore !== null ? latestScore : (bestScore ?? null);

  const maxAttempts = Number(exam.maxAttempts || exam.attemptLimit) || 0;
  const canReattempt = isCompleted && (maxAttempts === 0 || totalAttempts < maxAttempts);
  const attemptsRemaining = maxAttempts > 0 ? Math.max(0, maxAttempts - totalAttempts) : null;

  return {
    status,
    attemptStatus,
    hasAttempted,
    isCompleted,
    // Reattempt metrics
    totalAttempts,
    attempts: totalAttempts,
    total_attempts: totalAttempts,
    canReattempt,
    isReattemptEligible: canReattempt,
    allowReattempt: canReattempt,
    reattemptEligible: canReattempt,
    maxAttempts: maxAttempts > 0 ? maxAttempts : null,
    attemptsRemaining,
    hasInProgressAttempt: !!inProgressAttempt,
    inProgressAttemptId: inProgressAttempt?._id || null,
    latestScore,
    bestScore,
    previousScore: scoreValue,
    score: scoreValue,
    totalMarks: primaryResult && primaryResult.totalMarks ? primaryResult.totalMarks : defaultTotalMarks,
    lastAttemptedAt: (inProgressAttempt || latestCompletedResult || primaryResult)?.createdAt || null,
    submittedAt: latestCompletedResult ? (latestCompletedResult.createdAt || latestCompletedResult.updatedAt) : null,
    resultId: latestCompletedResult ? latestCompletedResult._id : (primaryResult ? primaryResult._id : null),
    latestResultId: latestCompletedResult ? latestCompletedResult._id : null,
    bestResultId: bestResult ? bestResult._id : null,
    latestAttempt: latestCompletedResult,
    bestAttempt: bestResult,
  };
}

module.exports = {
  getStudentCandidateIds,
  getStudentExamAttemptMap,
  computeExamAttemptMetrics,
};
