const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const xlsx = require('xlsx');
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
 * Helper to validate and sanitize a single question object.
 * Supports multi-format fields: passage (String), imageUrl (String), tableData (JSON/Array).
 * Returns { valid: boolean, error?: string, question?: object }
 */
function validateAndSanitizeQuestion(q, index = 0) {
  if (!q || typeof q !== 'object') {
    return { valid: false, error: `Question at index ${index} must be an object.` };
  }

  const rawQuestionText = q.questionText || q.text;
  if (!rawQuestionText || typeof rawQuestionText !== 'string' || !rawQuestionText.trim()) {
    return { valid: false, error: `Question ${index + 1} is missing a valid questionText.` };
  }

  if (!q.options || typeof q.options !== 'object') {
    return { valid: false, error: `Question ${index + 1} is missing valid options.` };
  }

  const sanitizedOptions = {};
  for (const opt of ['A', 'B', 'C', 'D']) {
    const val = q.options[opt];
    if (val === undefined || val === null || String(val).trim() === '') {
      return { valid: false, error: `Question ${index + 1} is missing option ${opt}.` };
    }
    sanitizedOptions[opt] = String(val).trim();
  }

  const rawCorrect = q.correctOption !== undefined ? q.correctOption : q.correctAnswer;
  const normalizedCorrect = rawCorrect ? String(rawCorrect).trim().toUpperCase() : '';
  if (!['A', 'B', 'C', 'D'].includes(normalizedCorrect)) {
    return { valid: false, error: `Question ${index + 1} must have correctOption as 'A', 'B', 'C', or 'D'.` };
  }

  const sanitizedQuestion = {
    questionText: rawQuestionText.trim(),
    options: sanitizedOptions,
    correctOption: normalizedCorrect,
    passage: null,
    imageUrl: null,
    tableData: null
  };

  if (q._id && mongoose.Types.ObjectId.isValid(q._id)) {
    sanitizedQuestion._id = q._id;
  }

  // passage (optional String)
  if (q.passage !== undefined && q.passage !== null && q.passage !== '') {
    if (typeof q.passage !== 'string') {
      return { valid: false, error: `Question ${index + 1}: passage must be a string.` };
    }
    sanitizedQuestion.passage = q.passage.trim();
  }

  // imageUrl (optional String)
  if (q.imageUrl !== undefined && q.imageUrl !== null && q.imageUrl !== '') {
    if (typeof q.imageUrl !== 'string') {
      return { valid: false, error: `Question ${index + 1}: imageUrl must be a string.` };
    }
    sanitizedQuestion.imageUrl = q.imageUrl.trim();
  }

  // tableData (optional JSON/Array structure)
  if (q.tableData !== undefined && q.tableData !== null && q.tableData !== '') {
    if (typeof q.tableData === 'string') {
      try {
        sanitizedQuestion.tableData = JSON.parse(q.tableData);
      } catch (e) {
        return { valid: false, error: `Question ${index + 1}: tableData must be a valid JSON or Array structure.` };
      }
    } else if (Array.isArray(q.tableData) || typeof q.tableData === 'object') {
      sanitizedQuestion.tableData = q.tableData;
    } else {
      return { valid: false, error: `Question ${index + 1}: tableData must be a JSON object or Array.` };
    }
  }

  return { valid: true, question: sanitizedQuestion };
}

/**
 * Helper to validate an array of question objects.
 */
function validateAndSanitizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { valid: false, error: 'questions field must be a non-empty array.' };
  }

  const sanitizedQuestions = [];
  for (let i = 0; i < questions.length; i++) {
    const res = validateAndSanitizeQuestion(questions[i], i);
    if (!res.valid) {
      return { valid: false, error: res.error };
    }
    sanitizedQuestions.push(res.question);
  }

  return { valid: true, questions: sanitizedQuestions };
}

/**
 * POST /api/exams/extract-mcqs
 * Extracts MCQs from uploaded PDF file buffer.
 */
async function extractMCQs(req, res) {
  try {
    // Dynamically handle req.file or req.files array
    const uploadedFile = req.file || (req.files && req.files[0]);

    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        message: "Please upload a valid PDF, Image, or Excel/CSV file."
      });
    }

    const fileBuffer = uploadedFile.buffer;
    const fileName = uploadedFile.originalname.toLowerCase();
    let questions = [];

    // A. Excel & CSV Processing (.xlsx, .xls, .csv)
    if (fileName.match(/\.(xlsx|xls|csv)$/i)) {
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      questions = sheetData.map((row) => ({
        questionText: String(row.Question || row.questionText || row['Question Text'] || '').trim(),
        options: {
          A: String(row.OptionA || row.A || row['Option A'] || '').trim(),
          B: String(row.OptionB || row.B || row['Option B'] || '').trim(),
          C: String(row.OptionC || row.C || row['Option C'] || '').trim(),
          D: String(row.OptionD || row.D || row['Option D'] || '').trim()
        },
        correctOption: String(row.CorrectOption || row.correctOption || row['Correct Answer'] || 'A').toUpperCase().trim()
      }));
    } 
    // B. Image OCR Processing (.png, .jpg, .jpeg, .webp)
    else if (fileName.match(/\.(png|jpg|jpeg|webp)$/i)) {
      const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng');
      questions = parseMCQText(text); // Utilizing our pre-existing parser function
    } 
    // C. PDF Processing (.pdf)
    else if (fileName.endsWith('.pdf')) {
      const pdfData = await pdfParse(fileBuffer);
      questions = parseMCQText(pdfData.text); // Utilizing our pre-existing parser function
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file format' });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully extracted ${questions.length} MCQs.`,
      questions
    });
  } catch (error) {
    console.error('Error extracting MCQs:', error);
    return res.status(500).json({
      success: false,
      message: "Failed to extract questions from uploaded file.",
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

    // Validate required fields
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

    // Validate negative mark parameter (supports negativeMark, negativeMarks, and negativeMarkPenalty)
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

    const questionValidation = validateAndSanitizeQuestions(questions);
    if (!questionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: questionValidation.error
      });
    }

    // Create final exam in database
    const newExam = await Exam.create({
      title: title.trim(),
      marksPerQuestion: parsedMarksPerQuestion,
      negativeMark: parsedNegMark,
      negativeMarkPenalty: parsedNegMark,
      durationMinutes: parsedDuration,
      totalQuestions: parsedTotalQuestions,
      questions: questionValidation.questions
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

    const updates = {};

    if (req.body.title !== undefined) updates.title = req.body.title.trim();
    if (req.body.marksPerQuestion !== undefined) {
      const parsedMarks = Number(req.body.marksPerQuestion);
      if (isNaN(parsedMarks) || parsedMarks <= 0) {
        return res.status(400).json({ success: false, message: 'marksPerQuestion must be a positive number.' });
      }
      updates.marksPerQuestion = parsedMarks;
    }
    if (req.body.durationMinutes !== undefined) {
      const parsedDuration = Number(req.body.durationMinutes);
      if (isNaN(parsedDuration) || parsedDuration <= 0) {
        return res.status(400).json({ success: false, message: 'durationMinutes must be a positive number.' });
      }
      updates.durationMinutes = parsedDuration;
    }
    if (req.body.totalQuestions !== undefined) {
      const parsedTotal = Number(req.body.totalQuestions);
      if (isNaN(parsedTotal) || parsedTotal <= 0) {
        return res.status(400).json({ success: false, message: 'totalQuestions must be a positive number.' });
      }
      updates.totalQuestions = parsedTotal;
    }

    const rawNegMark = req.body.negativeMark !== undefined
      ? req.body.negativeMark
      : (req.body.negativeMarks !== undefined ? req.body.negativeMarks : req.body.negativeMarkPenalty);

    if (rawNegMark !== undefined && rawNegMark !== null && rawNegMark !== '') {
      const parsedNegMark = Number(rawNegMark);
      if (isNaN(parsedNegMark) || parsedNegMark < 0) {
        return res.status(400).json({
          success: false,
          message: 'negativeMark must be a valid non-negative number.'
        });
      }
      updates.negativeMark = parsedNegMark;
      updates.negativeMarkPenalty = parsedNegMark;
    }

    if (req.body.questions !== undefined) {
      const questionValidation = validateAndSanitizeQuestions(req.body.questions);
      if (!questionValidation.valid) {
        return res.status(400).json({
          success: false,
          message: questionValidation.error
        });
      }
      updates.questions = questionValidation.questions;
      if (!updates.totalQuestions && !req.body.totalQuestions) {
        updates.totalQuestions = questionValidation.questions.length;
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
 * DELETE /api/exams/:id or /api/exams/grand-mock/:id
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
        message: 'Exam not found.'
      });
    }

    // Clean up any associated test results asynchronously
    try {
      const TestResult = mongoose.models.TestResult || require('../src/common/models/testResult.model');
      if (TestResult) {
        await TestResult.deleteMany({ examId: id });
      }
    } catch (cleanupError) {
      console.warn('[deleteExam] Could not clean up associated test results:', cleanupError.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Exam deleted successfully.',
      deletedExamId: id,
      data: exam
    });
  } catch (error) {
    console.error('Error deleting Exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete Exam.',
      error: error.message
    });
  }
}

/**
 * POST /api/exams/:id/questions
 * Add a single multi-format question to an existing exam.
 */
async function addQuestionToExam(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Exam ID format.' });
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Grand Mock Exam not found.' });
    }

    const validation = validateAndSanitizeQuestion(req.body, exam.questions.length);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    exam.questions.push(validation.question);
    exam.totalQuestions = exam.questions.length;
    await exam.save();

    const addedQuestion = exam.questions[exam.questions.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Question added successfully.',
      question: addedQuestion,
      totalQuestions: exam.totalQuestions
    });
  } catch (error) {
    console.error('Error adding question to exam:', error);
    return res.status(500).json({ success: false, message: 'Failed to add question to exam.', error: error.message });
  }
}

/**
 * PUT /api/exams/:id/questions/:questionId
 * Edit a specific question within an exam.
 */
async function updateQuestionInExam(req, res) {
  try {
    const { id, questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: 'Invalid Exam ID or Question ID format.' });
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Grand Mock Exam not found.' });
    }

    const qSubDoc = exam.questions.id(questionId);
    if (!qSubDoc) {
      return res.status(404).json({ success: false, message: 'Question not found in exam.' });
    }

    const mergedInput = {
      ...qSubDoc.toObject(),
      ...req.body
    };

    const validation = validateAndSanitizeQuestion(mergedInput);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    qSubDoc.questionText = validation.question.questionText;
    qSubDoc.options = validation.question.options;
    qSubDoc.correctOption = validation.question.correctOption;
    qSubDoc.passage = validation.question.passage;
    qSubDoc.imageUrl = validation.question.imageUrl;
    qSubDoc.tableData = validation.question.tableData;

    await exam.save();

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully.',
      question: qSubDoc
    });
  } catch (error) {
    console.error('Error updating question in exam:', error);
    return res.status(500).json({ success: false, message: 'Failed to update question in exam.', error: error.message });
  }
}

/**
 * DELETE /api/exams/:id/questions/:questionId
 * Delete a specific question from an exam.
 */
async function deleteQuestionFromExam(req, res) {
  try {
    const { id, questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: 'Invalid Exam ID or Question ID format.' });
    }

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Grand Mock Exam not found.' });
    }

    const qSubDoc = exam.questions.id(questionId);
    if (!qSubDoc) {
      return res.status(404).json({ success: false, message: 'Question not found in exam.' });
    }

    qSubDoc.deleteOne();
    exam.totalQuestions = exam.questions.length;
    await exam.save();

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully.',
      totalQuestions: exam.totalQuestions
    });
  } catch (error) {
    console.error('Error deleting question from exam:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete question from exam.', error: error.message });
  }
}

const deleteExam = deleteGrandMockExam;

module.exports = {
  extractMCQs,
  createGrandMockExam,
  getAllGrandMocks,
  getGrandMockById,
  updateGrandMockExam,
  deleteGrandMockExam,
  deleteExam,
  addQuestionToExam,
  updateQuestionInExam,
  deleteQuestionFromExam,
  validateAndSanitizeQuestion,
  validateAndSanitizeQuestions,
  parseMCQText // Exported for test verification
};

