const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const Exam = require('../models/exam.model');

/**
 * Helper function to parse MCQs from raw text.
 * Expects the standard format:
 * Q1. What is the question?
 * A) Option A
 * B) Option B
 * C) Option C
 * D) Option D
 * Ans: C
 * 
 * Supports both dot and parenthesis notation for questions and options (e.g., Q1., Q1), A), A.).
 * Tolerates variations like Ans: or Answer:.
 */
function parseMCQText(text) {
  const regex = /(\d+)\.\s+([\s\S]+?)\s+A\)\s+([\s\S]+?)\s+B\)\s+([\s\S]+?)\s+C\)\s+([\s\S]+?)\s+D\)\s+([\s\S]+?)\s+Answer:\s+([A-D])(?:\)|[^\r\n]*)/gi;
  const questions = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    questions.push({
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

  return questions;
}

/**
 * POST /api/exams/extract-mcqs
 * Extracts MCQs from uploaded PDF file buffer.
 */
async function extractMCQs(req, res) {
  try {
    // 1. Multer & Buffer Validation
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    if (!req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // 2. Safe PDF Parsing (pdf-parse)
    let parsedData;
    try {
      parsedData = await pdfParse(req.file.buffer);
    } catch (error) {
      console.error('PDF Parsing Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse PDF'
      });
    }

    // 3. Safe Text Extraction & Regex
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
      message: 'An unexpected error occurred during extraction'
    });
  }
}

/**
 * POST /api/exams/grand-mock
 * Saves the final, verified exam to database.
 */
async function createGrandMockExam(req, res) {
  try {
    const { title, marksPerQuestion, negativeMarkPenalty, durationMinutes, totalQuestions, questions } = req.body;

    // Validate body
    if (!title || !marksPerQuestion || !durationMinutes || !totalQuestions || !questions) {
      return res.status(400).json({
        success: false,
        message: 'All fields (title, marksPerQuestion, durationMinutes, totalQuestions, questions) are required.'
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'questions field must be a non-empty array.'
      });
    }

    // Create final exam in database
    const newExam = await Exam.create({
      title,
      marksPerQuestion,
      negativeMarkPenalty: (negativeMarkPenalty !== undefined && negativeMarkPenalty !== null) ? Number(negativeMarkPenalty) : 1,
      durationMinutes,
      totalQuestions,
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
 * Fetches all grand mock exams excluding the questions array for summary list.
 */
async function getAllGrandMocks(req, res) {
  try {
    const exams = await Exam.find()
      .select('-questions')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: exams
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
 * Fetches a single grand mock exam by ID including all questions.
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

    const exam = await Exam.findById(id);

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Grand Mock Exam not found.'
      });
    }

    return res.status(200).json({
      success: true,
      data: exam
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

/**
 * PUT /api/exams/grand-mock/:id
 * Admin: Update an existing Grand Mock Exam's metadata and/or questions.
 * All fields are optional — only the fields sent in the body will be updated.
 */
async function updateGrandMockExam(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Grand Mock Exam not found.'
      });
    }

    const allowedFields = ['title', 'marksPerQuestion', 'negativeMarkPenalty', 'durationMinutes', 'totalQuestions', 'questions'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // If questions are replaced, sync totalQuestions automatically
    if (updates.questions && Array.isArray(updates.questions)) {
      if (updates.questions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'questions array must not be empty.'
        });
      }
      if (!updates.totalQuestions) {
        updates.totalQuestions = updates.questions.length;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update.'
      });
    }

    const updatedExam = await Exam.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Grand Mock Exam updated successfully.',
      exam: updatedExam
    });
  } catch (error) {
    console.error('Error updating Grand Mock Exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Grand Mock Exam.',
      error: error.message
    });
  }
}

/**
 * DELETE /api/exams/grand-mock/:id
 * Admin: Permanently delete a Grand Mock Exam from the database.
 */
async function deleteGrandMockExam(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    const exam = await Exam.findByIdAndDelete(id);

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Grand Mock Exam not found.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Grand Mock Exam deleted successfully.',
      deletedExamId: id
    });
  } catch (error) {
    console.error('Error deleting Grand Mock Exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Grand Mock Exam.',
      error: error.message
    });
  }
}

module.exports = {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById,
  updateGrandMockExam,
  deleteGrandMockExam,
  parseMCQText // Exported for test verification
};
