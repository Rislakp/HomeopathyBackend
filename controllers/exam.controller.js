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
  // Split the text into blocks starting with Q followed by digit(s)
  const blocks = text.split(/(?=Q\d+[\.\s\)])/gi);
  const questions = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    // Skip empty blocks or blocks that do not start with a question identifier
    if (!trimmed || !/^Q\d+/i.test(trimmed)) {
      continue;
    }

    // Extract Question Text (from Q1. up to A) or A.)
    const qTextMatch = trimmed.match(/Q\d+[\.\s\)]+([\s\S]*?)(?=\s*A[\)\.])/i);
    
    // Extract Options
    const optAMatch = trimmed.match(/A[\)\.]\s*([\s\S]*?)(?=\s*B[\)\.])/i);
    const optBMatch = trimmed.match(/B[\)\.]\s*([\s\S]*?)(?=\s*C[\)\.])/i);
    const optCMatch = trimmed.match(/C[\)\.]\s*([\s\S]*?)(?=\s*D[\)\.])/i);
    
    // Option D goes up to Ans: or Answer:
    const optDMatch = trimmed.match(/D[\)\.]\s*([\s\S]*?)(?=\s*(Ans|Answer):)/i) 
                      || trimmed.match(/D[\)\.]\s*([\s\S]*?)$/i);

    // Extract Correct Option
    const ansMatch = trimmed.match(/(?:Ans|Answer):\s*([A-D])/i);

    if (qTextMatch && optAMatch && optBMatch && optCMatch && optDMatch && ansMatch) {
      questions.push({
        questionText: qTextMatch[1].trim(),
        options: {
          A: optAMatch[1].trim(),
          B: optBMatch[1].trim(),
          C: optCMatch[1].trim(),
          D: optDMatch[1].trim()
        },
        correctOption: ansMatch[1].trim().toUpperCase()
      });
    }
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
    const pdfData = await pdfParse(req.file.buffer);
    const parsedQuestions = parseMCQText(pdfData.text);

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
