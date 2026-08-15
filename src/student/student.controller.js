const mongoose = require('mongoose');
const Exam = require('../common/models/exam.model');
const TestResult = require('../common/models/testResult.model');

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
 * POST /api/student/exams/:id/submit
 * Submits student's answers, evaluates against the database, computes final score, and saves TestResult.
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
    // marksPerQuestion  : positive marks for each correct answer (e.g. 4)
    // negativeMarkPenalty: marks deducted for each wrong answer  (e.g. 1)
    // Unanswered questions always receive 0 marks with no penalty.
    const MARKS_CORRECT   = exam.marksPerQuestion     || 4; // fallback: 4
    const MARKS_PENALTY   = exam.negativeMarkPenalty  ?? 1; // fallback: 1

    const totalQuestions = exam.questions.length || exam.totalQuestions || 0;
    // maximumScore: marks if every question is answered correctly
    const maximumScore = totalQuestions * MARKS_CORRECT;
    // totalMarks: backward-compatible alias for admin aggregation pipeline
    const totalMarks = maximumScore;

    // Create lookup map for exam questions by question _id string
    const questionMap = new Map();
    exam.questions.forEach((q, index) => {
      if (q._id) {
        questionMap.set(q._id.toString(), q);
      }
      // Fallback matching by index if questionId is passed as index
      questionMap.set(index.toString(), q);
    });

    let totalAttempted = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    const processedAnswers = [];

    // 2. Evaluate each submitted answer
    for (const ans of answers) {
      const qId = ans.questionId ? ans.questionId.toString() : null;
      const targetQuestion = qId ? questionMap.get(qId) : null;
      const selectedOption = ans.selectedOption ? ans.selectedOption.toString().trim().toUpperCase() : null;

      if (targetQuestion) {
        const isAttempted = selectedOption !== null && selectedOption !== '';
        const isCorrect = isAttempted && selectedOption === targetQuestion.correctOption.toUpperCase();

        if (isAttempted) {
          totalAttempted++;
          if (isCorrect) {
            totalCorrect++;
          } else {
            totalWrong++;
          }
        }

        processedAnswers.push({
          questionId: targetQuestion._id || (mongoose.Types.ObjectId.isValid(qId) ? qId : null),
          selectedOption: selectedOption,
          isCorrect: isCorrect
        });
      }
    }

    // 3. Compute score using negative-marking formula (values from DB)
    //    finalScore = (correctAnswers × marksPerQuestion) - (wrongAnswers × negativeMarkPenalty)
    const positiveMarks       = totalCorrect * MARKS_CORRECT;    // e.g. 15 × 4 = 60
    const negativeMarks       = totalWrong   * MARKS_PENALTY;    // e.g.  3 × 1 =  3
    const finalScore          = positiveMarks - negativeMarks;   // e.g. 60 - 3  = 57
    const unansweredQuestions = totalQuestions - totalAttempted; // e.g. 20 - 18 =  2
    const percentage          = maximumScore > 0
      ? Math.round((finalScore / maximumScore) * 10000) / 100    // rounded to 2 dp
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
      positiveMarks,
      negativeMarks,
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
        negativeMarkPenalty:  MARKS_PENALTY,
        // ── Scoring Breakdown ──────────────────────────────────────
        totalQuestions:       totalQuestions,
        attemptedQuestions:   totalAttempted,
        correctAnswers:       totalCorrect,
        wrongAnswers:         totalWrong,
        unansweredQuestions:  unansweredQuestions,
        // ── Marks ─────────────────────────────────────────────────
        positiveMarks:        positiveMarks,
        negativeMarks:        negativeMarks,
        finalScore:           finalScore,
        maximumScore:         maximumScore,
        percentage:           percentage,
        // ── Legacy Fields (preserved for admin dashboard) ─────────
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
      .populate('examId', 'title marksPerQuestion durationMinutes totalQuestions')
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
  getAvailableExams,
  startExam,
  submitExam,
  getStudentResults
};
