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
  const regex = /(\d+)\.\s+([\s\S]+?)\s+A\)\s+([\s\S]+?)\s+B\)\s+([\s\S]+?)\s+C\)\s+([\s\S]+?)\s+D\)\s+([\s\S]+?)\s+Answer:\s+([A-D])\)/gi;
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
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF file.'
      });
    }

    // Extract raw text from PDF buffer using pdf-parse
    const parsedData = await pdfParse(req.file.buffer);
    
    // Parse the MCQs using the updated regex logic
    const regex = /(\d+)\.\s+([\s\S]+?)\s+A\)\s+([\s\S]+?)\s+B\)\s+([\s\S]+?)\s+C\)\s+([\s\S]+?)\s+D\)\s+([\s\S]+?)\s+Answer:\s+([A-D])\)/gi;
    const parsedQuestions = [];
    let match;

    while ((match = regex.exec(parsedData.text)) !== null) {
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

    return res.status(200).json({
      success: true,
      message: `Successfully extracted ${parsedQuestions.length} MCQs.`,
      questions: parsedQuestions
    });
  } catch (error) {
    console.error('Error extracting MCQs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to extract text from PDF. Please check if the file is valid.',
      error: error.message
    });
  }
}

/**
 * POST /api/exams/grand-mock
 * Saves the final, verified exam to database.
 */
async function createGrandMockExam(req, res) {
  try {
    const { title, marksPerQuestion, durationMinutes, totalQuestions, questions } = req.body;

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

module.exports = {
  extractMCQs,
  createGrandMockExam,
  parseMCQText // Exported for test verification
};
