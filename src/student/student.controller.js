const mongoose = require('mongoose');
const Exam = require('../common/models/exam.model');
const TestResult = require('../common/models/testResult.model');
const Student = require('../../models/Student');
const User = require('../../models/User');

/**
 * GET /api/student/profile (or /api/student/me)
 * Fetch authenticated student's profile details.
 */
async function getStudentProfile(req, res) {
  try {
    const studentId = req.user && (req.user.id || req.user.userId);
    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    const email = req.user.email;
    const isObjectId = mongoose.Types.ObjectId.isValid(studentId);

    // 1. Look up Student record first
    let studentDoc = null;
    if (isObjectId) {
      studentDoc = await Student.findOne({
        $or: [
          { _id: new mongoose.Types.ObjectId(studentId) },
          { userId: new mongoose.Types.ObjectId(studentId) },
          ...(email ? [{ email: email.toLowerCase().trim() }] : [])
        ]
      }).lean();
    } else if (email) {
      studentDoc = await Student.findOne({ email: email.toLowerCase().trim() }).lean();
    }

    // 2. Look up User record to ensure all fresh user fields are present
    let userDoc = null;
    if (isObjectId) {
      userDoc = await User.findById(studentId).select('-password').lean();
    }
    if (!userDoc && email) {
      userDoc = await User.findOne({ email: email.toLowerCase().trim() }).select('-password').lean();
    }

    if (!studentDoc && !userDoc) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.'
      });
    }

    // Determine canonical ID
    const profileId = (studentDoc && studentDoc._id ? studentDoc._id.toString() : null) ||
                      (userDoc && userDoc._id ? userDoc._id.toString() : studentId);

    const name = (studentDoc && studentDoc.name) || (userDoc && userDoc.name) || (req.user && req.user.name) || '';
    const studentEmail = (studentDoc && studentDoc.email) || (userDoc && userDoc.email) || (req.user && req.user.email) || '';
    const contactNumber = (studentDoc && (studentDoc.contactNumber || studentDoc.phone)) ||
                          (userDoc && (userDoc.contactNumber || userDoc.phone)) || '';
    const dateOfBirth = (studentDoc && studentDoc.dateOfBirth) || (userDoc && userDoc.dateOfBirth) || '';
    const qualification = (studentDoc && studentDoc.qualification) || (userDoc && userDoc.qualification) || '';
    const course = (studentDoc && studentDoc.course) || 'General';
    const subscription = (studentDoc && studentDoc.subscription) || 'Free';
    const status = (studentDoc && studentDoc.status) || 'Active';
    const profileImage = (studentDoc && (studentDoc.profileImage || studentDoc.avatar)) || '';

    return res.status(200).json({
      success: true,
      message: 'Student profile fetched successfully',
      data: {
        id: profileId,
        name,
        email: studentEmail,
        contactNumber,
        dateOfBirth,
        qualification,
        course,
        subscription,
        status,
        profileImage
      }
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch student profile.',
      error: error.message
    });
  }
}

/**
 * GET /api/student/exams
 * Fetch all available exams for student, annotating each with attempt status and previous score.
 */
async function getAvailableExams(req, res) {
  try {
    const studentId = req.user && req.user.id;
    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    // 1. Fetch all exams (excluding questions for lightweight summary)
    const exams = await Exam.find()
      .select('-questions')
      .sort({ createdAt: -1 })
      .lean();

    // 2. Fetch student's test results
    const studentResults = await TestResult.find({ studentId })
      .sort({ createdAt: -1 })
      .lean();

    // 3. Map results by examId (latest attempt per exam)
    const resultMap = new Map();
    for (const result of studentResults) {
      const examIdStr = result.examId.toString();
      if (!resultMap.has(examIdStr)) {
        resultMap.set(examIdStr, result);
      }
    }

    // 4. Combine exams with student's previous status and score
    const formattedExams = exams.map((exam) => {
      const examIdStr = exam._id.toString();
      const previousResult = resultMap.get(examIdStr);

      return {
        ...exam,
        negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
          ? exam.negativeMark
          : (exam.negativeMarkPenalty ?? 0),
        status: previousResult ? 'Attempted' : 'Not Started',
        previousScore: previousResult ? previousResult.score : null,
        totalMarks: previousResult
          ? previousResult.totalMarks
          : (exam.totalQuestions || 0) * (exam.marksPerQuestion || 1),
        lastAttemptedAt: previousResult ? previousResult.createdAt : null,
        resultId: previousResult ? previousResult._id : null
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedExams.length,
      data: formattedExams
    });
  } catch (error) {
    console.error('Error fetching student available exams:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch available exams.',
      error: error.message
    });
  }
}

/**
 * GET /api/student/exams/:id/start
 * Fetch exam details for starting a test.
 * CRITICAL ANTI-CHEAT: Strips the `correctOption` field from all questions before sending to client.
 */
async function startExam(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    const exam = await Exam.findById(id).lean();

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Grand Mock Exam not found.'
      });
    }

    // Sanitize questions to prevent cheating - completely remove `correctOption`
    const sanitizedQuestions = (exam.questions || []).map((q) => {
      const { correctOption, ...questionWithoutAnswer } = q;
      return questionWithoutAnswer;
    });

    return res.status(200).json({
      success: true,
      data: {
        ...exam,
        negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
          ? exam.negativeMark
          : (exam.negativeMarkPenalty ?? 0),
        questions: sanitizedQuestions
      }
    });
  } catch (error) {
    console.error('Error starting exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start exam.',
      error: error.message
    });
  }
}

/**
 * Helper function to normalize any option representation (letter, option string, index, or option text)
 * into a canonical option key: 'A', 'B', 'C', or 'D'.
 * Returns null if unattempted, empty, or invalid.
 */
function normalizeOptionKey(rawOption, questionOptions) {
  if (rawOption === null || rawOption === undefined) {
    return null;
  }

  // Convert to string and trim whitespace
  let str = String(rawOption).trim();
  if (str === '' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return null;
  }

  const uppercaseStr = str.toUpperCase();

  // 1. Direct single letter check ('A', 'B', 'C', 'D')
  if (['A', 'B', 'C', 'D'].includes(uppercaseStr)) {
    return uppercaseStr;
  }

  // 2. Prefix pattern match (e.g., "Option A", "Option_A", "OPT A", "Opt. A", "A)", "A.", "A - ...", "Answer: A")
  const prefixMatch = uppercaseStr.match(/^(?:OPTION|OPT|ANSWER)?[\s._:-]*([A-D])(?:\)|\.|\s|-|$)/i);
  if (prefixMatch && ['A', 'B', 'C', 'D'].includes(prefixMatch[1].toUpperCase())) {
    return prefixMatch[1].toUpperCase();
  }

  // 3. Numeric index matching (0 -> A, 1 -> B, 2 -> C, 3 -> D)
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num === 0) return 'A';
    if (num === 1) return 'B';
    if (num === 2) return 'C';
    if (num === 3) return 'D';
  }

  // 4. Option text matching against questionOptions { A, B, C, D }
  if (questionOptions && typeof questionOptions === 'object') {
    const cleanInput = str.toLowerCase();

    for (const key of ['A', 'B', 'C', 'D']) {
      const optionText = questionOptions[key];
      if (optionText && typeof optionText === 'string') {
        const cleanOptionText = optionText.trim().toLowerCase();

        // Exact option text match
        if (cleanInput === cleanOptionText) {
          return key;
        }

        // Match if input stripped of prefix ("A) ", "A. ") matches option text
        const strippedInput = cleanInput.replace(/^(?:option|opt)?[\s._:-]*[a-d][\).\s_-]*/i, '').trim();
        if (strippedInput && strippedInput === cleanOptionText) {
          return key;
        }

        // Match if option text stripped of prefix matches input
        const strippedOptionText = cleanOptionText.replace(/^(?:option|opt)?[\s._:-]*[a-d][\).\s_-]*/i, '').trim();
        if (strippedOptionText && (cleanInput === strippedOptionText || strippedInput === strippedOptionText)) {
          return key;
        }
      }
    }
  }

  return null;
}

/**
 * POST /api/student/exams/:id/submit
 * Submits student's answers, evaluates against the database with robust answer verification and negative marking calculation,
 * computes final score, and saves TestResult.
 * Payload: { answers: [{ questionId: "...", selectedOption: "A" }] }
 */
async function submitExam(req, res) {
  try {
    const { id } = req.params;
    const studentId = req.user && req.user.id;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid answers format. Expected an array of answers: [{ questionId, selectedOption }]'
      });
    }

    // 1. Fetch original exam with answer keys from database
    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found.'
      });
    }

    // ── Scoring Rules — read from the exam document stored in MongoDB ──────
    // marksPerQuestion: positive marks for each correct answer (default: 1)
    // negativeMark    : penalty deducted for each wrong answer (default: 0)
    // Unanswered questions always receive 0 marks with no penalty.
    const MARKS_CORRECT = Number(exam.marksPerQuestion) || 1;

    let rawPenalty = 0;
    if (exam.negativeMark !== undefined && exam.negativeMark !== null) {
      rawPenalty = Number(exam.negativeMark);
    } else if (exam.negativeMarks !== undefined && exam.negativeMarks !== null) {
      rawPenalty = Number(exam.negativeMarks);
    } else if (exam.negativeMarkPenalty !== undefined && exam.negativeMarkPenalty !== null) {
      rawPenalty = Number(exam.negativeMarkPenalty);
    }
    const MARKS_PENALTY = isNaN(rawPenalty) ? 0 : Math.abs(rawPenalty);

    const totalQuestions = (exam.questions && exam.questions.length) || exam.totalQuestions || 0;
    const maximumScore = totalQuestions * MARKS_CORRECT;
    const totalMarks = maximumScore;

    // Create lookup map for exam questions by question _id string and index
    const questionMap = new Map();
    if (Array.isArray(exam.questions)) {
      exam.questions.forEach((q, index) => {
        if (q._id) {
          questionMap.set(q._id.toString(), q);
        }
        // Support index-based lookup (0-indexed and 1-indexed)
        questionMap.set(index.toString(), q);
        questionMap.set((index + 1).toString(), q);
      });
    }

    let totalAttempted = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    let positiveMarks = 0;
    let negativeMarks = 0;
    const processedAnswers = [];

    // 2. Evaluate each submitted answer with robust option matching
    for (const ans of answers) {
      const qId = ans.questionId !== undefined && ans.questionId !== null ? ans.questionId.toString().trim() : null;
      const targetQuestion = qId ? questionMap.get(qId) : null;

      if (targetQuestion) {
        // Robust option normalization for both selectedOption and correctOption
        const userOptionKey = normalizeOptionKey(ans.selectedOption, targetQuestion.options);
        const correctOptionKey = normalizeOptionKey(targetQuestion.correctOption, targetQuestion.options);

        const isAttempted = userOptionKey !== null;
        const isCorrect = isAttempted && correctOptionKey !== null && userOptionKey === correctOptionKey;

        if (isAttempted) {
          totalAttempted++;
          if (isCorrect) {
            totalCorrect++;
            positiveMarks += MARKS_CORRECT;
          } else {
            totalWrong++;
            negativeMarks += MARKS_PENALTY;
          }
        }

        processedAnswers.push({
          questionId: targetQuestion._id || (mongoose.Types.ObjectId.isValid(qId) ? qId : null),
          selectedOption: userOptionKey, // Guaranteed 'A', 'B', 'C', 'D' or null
          isCorrect: isCorrect
        });
      }
    }

    // 3. Compute score using negative-marking formula (values from DB)
    //    finalScore = (correctAnswers × marksPerQuestion) - (wrongAnswers × negativeMark)
    const rawFinalScore = positiveMarks - negativeMarks;
    const finalScore = Math.round(rawFinalScore * 100) / 100;
    const unansweredQuestions = Math.max(0, totalQuestions - totalAttempted);
    const percentage = maximumScore > 0
      ? Math.round((finalScore / maximumScore) * 10000) / 100
      : 0;

    // 4. Save TestResult document in MongoDB
    const testResult = await TestResult.create({
      studentId,
      examId: exam._id,
      score: finalScore,
      totalMarks,
      totalAttempted,
      totalCorrect,
      totalWrong,
      unansweredQuestions,
      positiveMarks: Math.round(positiveMarks * 100) / 100,
      negativeMarks: Math.round(negativeMarks * 100) / 100,
      maximumScore,
      percentage,
      status: 'Completed',
      answers: processedAnswers
    });

    return res.status(201).json({
      success: true,
      message: 'Exam submitted and evaluated successfully.',
      data: {
        _id:                  testResult._id,
        studentId:            testResult.studentId,
        examId:               testResult.examId,
        // ── Exam Rules Applied ─────────────────────────────────────
        marksPerQuestion:     MARKS_CORRECT,
        negativeMark:         MARKS_PENALTY,
        negativeMarkPenalty:  MARKS_PENALTY,
        // ── Scoring Breakdown ──────────────────────────────────────
        totalQuestions:       totalQuestions,
        attemptedQuestions:   totalAttempted,
        correctAnswers:       totalCorrect,
        wrongAnswers:         totalWrong,
        unansweredQuestions:  unansweredQuestions,
        // ── Marks ─────────────────────────────────────────────────
        positiveMarks:        Math.round(positiveMarks * 100) / 100,
        negativeMarks:        Math.round(negativeMarks * 100) / 100,
        finalScore:           finalScore,
        maximumScore:         maximumScore,
        percentage:           percentage,
        // ── Legacy Fields (preserved for backwards compatibility) ──
        score:                finalScore,
        totalMarks:           totalMarks,
        totalAttempted:       totalAttempted,
        totalCorrect:         totalCorrect,
        totalWrong:           totalWrong,
        // ──────────────────────────────────────────────────────────
        status:               testResult.status,
        answers:              testResult.answers,
        createdAt:            testResult.createdAt
      }
    });
  } catch (error) {
    console.error('Error submitting exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit exam.',
      error: error.message
    });
  }
}

/**
 * GET /api/student/results
 * Fetches all past test results for the authenticated student.
 */
async function getStudentResults(req, res) {
  try {
    const studentId = req.user && req.user.id;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    const results = await TestResult.find({ studentId })
      .populate('examId', 'title marksPerQuestion negativeMark negativeMarkPenalty durationMinutes totalQuestions')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Error fetching student test results:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch test results.',
      error: error.message
    });
  }
}

module.exports = {
  getStudentProfile,
  getAvailableExams,
  startExam,
  submitExam,
  getStudentResults
};
