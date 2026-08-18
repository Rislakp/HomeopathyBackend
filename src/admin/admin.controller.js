const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const Exam = require('../common/models/exam.model');

/**
 * POST /api/exams/extract-mcqs
 * Extracts MCQs from uploaded PDF file buffer.
 */
async function extractMCQs(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file uploaded.'
      });
    }

    let parsedData;
    try {
      parsedData = await pdfParse(req.file.buffer);
    } catch (error) {
      console.error('PDF Parsing Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse PDF.'
      });
    }

    if (!parsedData || typeof parsedData.text !== 'string') {
      return res.status(200).json({
        success: true,
        message: 'Successfully extracted 0 MCQs.',
        questions: []
      });
    }

    const text = parsedData.text;
    const regex = /(\d+)\.\s+([\s\S]+?)\s+A\)\s+([\s\S]+?)\s+B\)\s+([\s\S]+?)\s+C\)\s+([\s\S]+?)\s+D\)\s+([\s\S]+?)\s+Answer:\s+([A-D])(?:\)|[^\r\n]*)/gi;
    const parsedQuestions = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match[2] && match[3] && match[4] && match[5] && match[6] && match[7]) {
        parsedQuestions.push({
          questionText: match[2].trim(),
          options: {
            A: match[3].trim(),
            B: match[4].trim(),
            C: match[5].trim(),
            D: match[6].trim()
          },
          correctOption: match[7].trim().toUpperCase()
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully extracted ${parsedQuestions.length} MCQs.`,
      questions: parsedQuestions
    });
  } catch (error) {
    console.error('Error extracting MCQs:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during extraction.',
      error: error.message
    });
  }
}

/**
 * POST /api/exams/grand-mock
 * Saves verified exam document to database.
 */
async function createGrandMockExam(req, res) {
  try {
    const {
      title,
      marksPerQuestion,
      negativeMark,
      negativeMarks,
      negativeMarkPenalty,
      durationMinutes,
      totalQuestions,
      questions
    } = req.body;

    if (!title || marksPerQuestion === undefined || durationMinutes === undefined || totalQuestions === undefined || !questions) {
      return res.status(400).json({
        success: false,
        message: 'All fields (title, marksPerQuestion, durationMinutes, totalQuestions, questions) are required.'
      });
    }

    const parsedMarksPerQuestion = Number(marksPerQuestion);
    if (isNaN(parsedMarksPerQuestion) || parsedMarksPerQuestion <= 0) {
      return res.status(400).json({
        success: false,
        message: 'marksPerQuestion must be a positive number.'
      });
    }

    const parsedDuration = Number(durationMinutes);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: 'durationMinutes must be a positive number.'
      });
    }

    const parsedTotalQuestions = Number(totalQuestions);
    if (isNaN(parsedTotalQuestions) || parsedTotalQuestions <= 0) {
      return res.status(400).json({
        success: false,
        message: 'totalQuestions must be a positive number.'
      });
    }

    const rawNegMark = negativeMark !== undefined ? negativeMark : (negativeMarks !== undefined ? negativeMarks : negativeMarkPenalty);
    let parsedNegMark = 0;

    if (rawNegMark !== undefined && rawNegMark !== null && rawNegMark !== '') {
      parsedNegMark = Number(rawNegMark);
      if (isNaN(parsedNegMark) || parsedNegMark < 0) {
        return res.status(400).json({
          success: false,
          message: 'negativeMark must be a valid non-negative number.'
        });
      }
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'questions field must be a non-empty array.'
      });
    }

    const newExam = await Exam.create({
      title: title.trim(),
      marksPerQuestion: parsedMarksPerQuestion,
      negativeMark: parsedNegMark,
      negativeMarkPenalty: parsedNegMark,
      durationMinutes: parsedDuration,
      totalQuestions: parsedTotalQuestions,
      questions
    });

    return res.status(201).json({
      success: true,
      message: 'Grand Mock Exam created successfully.',
      exam: newExam
    });
  } catch (error) {
    console.error('Error creating Grand Mock Exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save the Grand Mock Exam to database.',
      error: error.message
    });
  }
}

/**
 * GET /api/exams/grand-mock
 * Admin screen 1: Fetch summary list without questions.
 */
async function getAllGrandMocks(req, res) {
  try {
    const exams = await Exam.find()
      .select('-questions')
      .sort({ createdAt: -1 })
      .lean();

    const formattedExams = exams.map((exam) => ({
      ...exam,
      negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
        ? exam.negativeMark
        : (exam.negativeMarkPenalty ?? 0)
    }));

    return res.status(200).json({
      success: true,
      data: formattedExams
    });
  } catch (error) {
    console.error('Error fetching Grand Mock exams:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Grand Mock exams.',
      error: error.message
    });
  }
}

/**
 * GET /api/exams/grand-mock/:id
 * Admin screen 2: Fetch single test with full questions.
 */
async function getGrandMockById(req, res) {
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

    const formattedExam = {
      ...exam,
      negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
        ? exam.negativeMark
        : (exam.negativeMarkPenalty ?? 0)
    };

    return res.status(200).json({
      success: true,
      data: formattedExam
    });
  } catch (error) {
    console.error('Error fetching Grand Mock Exam by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Grand Mock Exam details.',
      error: error.message
    });
  }
}

module.exports = {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById
};
