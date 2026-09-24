const unaniExamService = require('../services/unaniExam.service');
const {
  validateUnaniExamCreateOrUpdate,
  validateUnaniQuestion,
} = require('../validators/unaniExam.validator');

/**
 * POST /api/unani-exams
 * Create a new Unani exam (Admin only)
 */
async function createExam(req, res) {
  try {
    const validation = validateUnaniExamCreateOrUpdate(req.body, false);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const exam = await unaniExamService.createExam(req.body);
    return res.status(201).json({
      success: true,
      message: 'Unani exam created successfully.',
      data: exam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create Unani exam.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams
 * Get list of all Unani exams
 */
async function getAllExams(req, res) {
  try {
    const exams = await unaniExamService.getAllExams();
    return res.status(200).json({
      success: true,
      count: exams.length,
      data: exams,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exams.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:id
 * Get single Unani exam by ID
 */
async function getExamById(req, res) {
  try {
    const exam = await unaniExamService.getExamById(req.params.id);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }
    return res.status(200).json({
      success: true,
      data: exam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam details.',
      error: error.message,
    });
  }
}

/**
 * PUT /api/unani-exams/:id
 * Update Unani exam by ID (Admin only)
 */
async function updateExam(req, res) {
  try {
    const validation = validateUnaniExamCreateOrUpdate(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const updatedExam = await unaniExamService.updateExam(req.params.id, req.body);
    if (!updatedExam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani exam updated successfully.',
      data: updatedExam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update Unani exam.',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/unani-exams/:id
 * Delete Unani exam by ID (Admin only)
 */
async function deleteExam(req, res) {
  try {
    const deletedExam = await unaniExamService.deleteExam(req.params.id);
    if (!deletedExam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani exam deleted successfully.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Unani exam.',
      error: error.message,
    });
  }
}

/**
 * POST /api/unani-exams/:examId/questions
 * Add question to Unani exam (Admin only)
 */
async function addQuestion(req, res) {
  try {
    const validation = validateUnaniQuestion(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: validation.errors,
      });
    }

    const updatedExam = await unaniExamService.addQuestion(req.params.examId, req.body);
    if (!updatedExam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Question added successfully.',
      data: updatedExam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to add question to Unani exam.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/questions
 * Get questions for an Unani exam
 */
async function getQuestions(req, res) {
  try {
    const isStudent = req.user && (req.user.role || '').toLowerCase() === 'student';
    const questions = await unaniExamService.getQuestions(req.params.examId, isStudent);

    if (!questions) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      count: questions.length,
      data: questions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch questions for Unani exam.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/questions/:questionId
 * Get single question from Unani exam
 */
async function getQuestionById(req, res) {
  try {
    const question = await unaniExamService.getQuestionById(req.params.examId, req.params.questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question or Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: question,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch question.',
      error: error.message,
    });
  }
}

/**
 * PUT /api/unani-exams/:examId/questions/:questionId
 * Update question in Unani exam (Admin only)
 */
async function updateQuestion(req, res) {
  try {
    const updatedExam = await unaniExamService.updateQuestion(
      req.params.examId,
      req.params.questionId,
      req.body
    );
    if (!updatedExam) {
      return res.status(404).json({
        success: false,
        message: 'Question or Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully.',
      data: updatedExam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update question.',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/unani-exams/:examId/questions/:questionId
 * Delete question from Unani exam (Admin only)
 */
async function deleteQuestion(req, res) {
  try {
    const updatedExam = await unaniExamService.deleteQuestion(req.params.examId, req.params.questionId);
    if (!updatedExam) {
      return res.status(404).json({
        success: false,
        message: 'Question or Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully.',
      data: updatedExam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete question.',
      error: error.message,
    });
  }
}

/**
 * POST /api/unani-exams/:examId/questions/bulk
 * Bulk add questions to Unani exam (Admin only)
 */
async function addQuestionsBulk(req, res) {
  try {
    const questionsList = req.body.questions || req.body;
    if (!Array.isArray(questionsList) || questionsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Questions array is required for bulk creation.',
      });
    }

    const updatedExam = await unaniExamService.addQuestionsBulk(req.params.examId, questionsList);
    if (!updatedExam) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Questions added in bulk successfully.',
      data: updatedExam,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to bulk add questions to Unani exam.',
      error: error.message,
    });
  }
}

/**
 * POST /api/unani-exams/:examId/start
 * Start Unani exam (Student)
 */
async function startExam(req, res) {
  try {
    const testData = await unaniExamService.startExam(req.params.examId, req.user);
    if (!testData) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani exam started successfully.',
      data: testData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start Unani exam.',
      error: error.message,
    });
  }
}

/**
 * POST /api/unani-exams/:examId/submit
 * Submit Unani exam answers (Student)
 */
async function submitExam(req, res) {
  try {
    const result = await unaniExamService.submitExam(req.params.examId, req.user, req.body);
    if (result.error) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Unani exam submitted successfully.',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to submit Unani exam.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/results
 * Get results for Unani exam
 */
async function getResults(req, res) {
  try {
    const results = await unaniExamService.getResults(req.params.examId, req.user);
    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam results.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/results/:resultId
 * Get specific Unani exam result by ID
 */
async function getResultById(req, res) {
  try {
    const result = await unaniExamService.getResultById(req.params.examId, req.params.resultId, req.user);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Unani exam result not found.',
      });
    }

    if (result.forbidden) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view another student's exam result.",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam result.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/rank
 * Get Unani exam leaderboard / rank
 */
async function getRank(req, res) {
  try {
    const leaderboard = await unaniExamService.getRank(req.params.examId);
    return res.status(200).json({
      success: true,
      count: leaderboard.length,
      data: leaderboard,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam rankings.',
      error: error.message,
    });
  }
}

/**
 * GET /api/unani-exams/:examId/history
 * Get Unani exam history
 */
async function getHistory(req, res) {
  try {
    const history = await unaniExamService.getHistory(req.params.examId, req.user);
    return res.status(200).json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Unani exam history.',
      error: error.message,
    });
  }
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
