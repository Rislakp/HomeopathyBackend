const mongoose = require('mongoose');
const { resolveProfileImageUrl } = require('../utils/s3MediaSigner');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const xlsx = require('xlsx');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const Exam = require('../models/Exam');
const { verifyStudentCourseAccessAny } = require('../utils/courseAccessHelper');
const {
  getStudentCandidateIds,
  getStudentExamAttemptMap,
  computeExamAttemptMetrics
} = require('../utils/examAttemptHelper');
const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');
const { sanitizeQuestionForStudent } = require('../src/student/normalExamRules');
const {
  normalizeExamCourseIds,
  getExamAssignedCourseIds,
  expandLegacyCourseFiltersForExamArrays,
} = require('../utils/examCourseAssignment');
try { require('../models/Course'); } catch (e) { }

/**
 * Helper to resolve courseName and moduleName for an exam object (populated or plain).
 * Used for single-exam endpoints where batch resolution is not practical.
 */
async function resolveCourseAndModuleNames(exam) {
  if (!exam) return { courseName: null, moduleName: null };
  let courseName = exam.courseName || null;
  let moduleName = exam.moduleName || null;

  if (exam.courseId) {
    if (typeof exam.courseId === 'object' && !(exam.courseId instanceof mongoose.Types.ObjectId) && (exam.courseId.courseTitle || exam.courseId.title || exam.courseId.name)) {
      if (!courseName) {
        courseName = exam.courseId.courseTitle || exam.courseId.title || exam.courseId.name || null;
      }
      if (!moduleName && exam.moduleId && Array.isArray(exam.courseId.modules)) {
        const modObj = exam.courseId.modules.find(
          (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
        );
        if (modObj) {
          moduleName = modObj.moduleName || null;
        }
      }
    } else {
      const rawCourseId = exam.courseId ? exam.courseId.toString().trim() : '';
      const courseIdStr = (rawCourseId && rawCourseId !== 'null' && rawCourseId !== 'undefined') ? rawCourseId : null;
      if (courseIdStr && (!courseName || !moduleName)) {
        try {
          const isObjId = mongoose.Types.ObjectId.isValid(courseIdStr);
          const CourseModel = mongoose.models.Course || require('../models/Course');
          const foundCourse = await CourseModel.findOne({
            $or: [
              ...(isObjId ? [{ _id: new mongoose.Types.ObjectId(courseIdStr) }] : []),
              { courseId: courseIdStr },
              { _id: courseIdStr }
            ]
          }).lean();

          if (foundCourse) {
            if (!courseName) courseName = foundCourse.courseTitle || foundCourse.title || foundCourse.name || null;
            if (!moduleName && exam.moduleId && Array.isArray(foundCourse.modules)) {
              const modObj = foundCourse.modules.find(
                (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
              );
              if (modObj) {
                moduleName = modObj.moduleName || null;
              }
            }
          }
        } catch (err) {
          // Optional lookup error handled gracefully
        }
      }
    }
  }

  return { courseName, moduleName };
}

/**
 * Batch-resolve courseName and moduleName for a list of exams in ONE query.
 * Eliminates the N+1 per-exam resolveCourseAndModuleNames pattern for listing endpoints.
 * @param {Array} exams - lean exam documents
 * @returns {Map<string, { courseName: string|null, moduleName: string|null }>} courseMap keyed by courseId string
 */
async function batchResolveCourseNames(exams) {
  const courseIdsToFetch = new Set();
  for (const exam of exams) {
    if (exam.courseId && !exam.courseName) {
      const raw = (typeof exam.courseId === 'object' && exam.courseId._id) ? exam.courseId._id.toString() : exam.courseId.toString();
      if (raw && raw !== 'null' && raw !== 'undefined') courseIdsToFetch.add(raw.trim());
    }
  }

  const courseMap = new Map();
  if (courseIdsToFetch.size === 0) return courseMap;

  try {
    const CourseModel = mongoose.models.Course || require('../models/Course');
    const ids = [...courseIdsToFetch];
    const objIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
    const foundCourses = await CourseModel.find({
      $or: [
        ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
        { courseId: { $in: ids } }
      ]
    }).select('courseId courseTitle title name modules').lean();

    for (const fc of foundCourses) {
      if (fc._id) courseMap.set(fc._id.toString(), fc);
      if (fc.courseId) courseMap.set(fc.courseId, fc);
    }
  } catch (err) {
    // Batch course lookup failed gracefully
  }

  return courseMap;
}

/**
 * Local regex-based fallback parser.
 * Used when GEMINI_API_KEY is not available. Handles common MCQ formats from OCR text.
 * Includes safe fallback: if OCR text is corrupted/gibberish, returns a clean placeholder
 * instead of broken characters or crashing the UI.
 */
function parseRawTextLocal(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const mcqs = [];

  // Clean up OCR artifacts
  const cleanedText = rawText
    .replace(/[\u2014\u2013\u2012_]{2,}/g, ' ')  // Remove dashed/underscored lines
    .replace(/\r\n/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, '')              // Keep printable ASCII + newlines
    .replace(/[ \t]+/g, ' ')                      // Collapse multiple spaces/tabs
    .trim();

  // Safety check: if cleaned text is too short or looks like gibberish, return a single
  // placeholder MCQ so the frontend gets something reviewable instead of garbage.
  const meaningfulWords = cleanedText.split(/\s+/).filter(w => w.length > 2);
  if (!cleanedText || meaningfulWords.length < 5) {
    console.warn('[OCR Fallback] OCR text too short or corrupted. Returning placeholder.');
    return [{
      questionText: 'Extracted from Image (Please review - OCR could not read this clearly)',
      options: { A: '', B: '', C: '', D: '' },
      correctOption: 'A'
    }];
  }

  // Split by question start (e.g. "1.", "Q1:", "1)")
  const blocks = cleanedText.split(/\n(?=(?:Q|q)?\d+[\.\):])/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let questionText = '';
    const options = { A: '', B: '', C: '', D: '' };
    let correctOption = 'A';
    let isFirstLine = true;

    for (const line of lines) {
      if (isFirstLine) {
        const qMatch = line.match(/^(?:Q|q)?\d+[\.\):]?\s*(.*)/);
        questionText = (qMatch ? qMatch[1].trim() : line.trim()) || '';
        isFirstLine = false;
        continue;
      }

      // Options: A), A., (A), a)
      const optMatch = line.match(/^\(?([A-Da-d])[\.\)]\s+(.*)/);
      if (optMatch) {
        options[optMatch[1].toUpperCase()] = optMatch[2].trim();
        continue;
      }

      // Answers: "Answer:", "Ans:", "Correct:"
      const ansMatch = line.match(/(?:Ans(?:wer)?|Correct)\s*[:=\-]?\s*([A-D])/i);
      if (ansMatch) {
        correctOption = ansMatch[1].toUpperCase();
      }
    }

    if (questionText) {
      mcqs.push({ questionText, options, correctOption });
    }
  }

  // If regex parsing found nothing usable, return a safe placeholder
  if (mcqs.length === 0) {
    console.warn('[OCR Fallback] Regex could not parse any MCQs. Returning raw text as placeholder.');
    return [{
      questionText: 'Extracted from Image (Please review - OCR could not read this clearly)',
      options: { A: '', B: '', C: '', D: '' },
      correctOption: 'A'
    }];
  }

  return mcqs;
}

/**
 * Primary MCQ parser. Uses Gemini LLM if GEMINI_API_KEY is available,
 * otherwise falls back to local regex-based parsing.
 */
async function parseRawTextToMCQs(rawText) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];

  // Fallback to local regex parser if no API key is configured
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log("[OCR] GEMINI_API_KEY not set. Using local regex parser.");
    return parseRawTextLocal(rawText);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `You are an expert data extraction assistant. Extract multiple choice questions from the following OCR text.
The text might be garbled, have typos, or lack formatting. Reconstruct the text into clear questions and options.

Output exactly a JSON array of objects. Each object must follow this exact schema:
[
  {
    "questionText": "Exact question string from image",
    "options": {
      "A": "Option A text",
      "B": "Option B text",
      "C": "Option C text",
      "D": "Option D text"
    },
    "correctOption": "A" // The single capital letter of the correct answer (A, B, C, or D). Default to 'A' if unknown.
  }
]

Do not include any other text or markdown block backticks outside the JSON array.

OCR TEXT:
${rawText}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const parsedData = JSON.parse(response.text);
    return Array.isArray(parsedData) ? parsedData : [];
  } catch (error) {
    console.error("[LLM Parsing Error] Falling back to local parser.", error.message);
    return parseRawTextLocal(rawText);
  }
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
    tableData: null,
    explanation: ''
  };

  if (q.explanation !== undefined && q.explanation !== null && q.explanation !== '') {
    sanitizedQuestion.explanation = String(q.explanation).trim();
  }

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
  const rawImageUrl = (q.imageUrl !== undefined && q.imageUrl !== null && q.imageUrl !== '')
    ? q.imageUrl
    : (q.image_url || q.image || q.questionImage || q.imgUrl);

  if (rawImageUrl !== undefined && rawImageUrl !== null && rawImageUrl !== '') {
    if (typeof rawImageUrl !== 'string') {
      return { valid: false, error: `Question ${index + 1}: imageUrl must be a string.` };
    }
    sanitizedQuestion.imageUrl = rawImageUrl.trim();
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

// Concurrency control for expensive extractMCQs operations
let activeExtractionCount = 0;
const MAX_CONCURRENT_EXTRACTIONS = 1;
const recentExtractions = new Map(); // key -> timestamp

/**
 * POST /api/exams/extract-mcqs
 * Extracts MCQs from uploaded PDF file buffer.
 */
async function extractMCQs(req, res) {
  const file = req.file || (req.files && req.files[0]);
  if (!file) {
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }

  // 1. Guard against concurrent expensive extractions that could exhaust memory
  if (activeExtractionCount >= MAX_CONCURRENT_EXTRACTIONS) {
    return res.status(429).json({
      success: false,
      message: "An MCQ extraction is already processing. Please wait a few seconds and try again."
    });
  }

  // 2. Guard against rapid duplicate submissions (within 10s window)
  const extractionKey = `${req.user?._id || req.ip}_${file.size}_${file.originalname}`;
  const now = Date.now();
  const lastRun = recentExtractions.get(extractionKey);
  if (lastRun && (now - lastRun) < 10000) {
    return res.status(429).json({
      success: false,
      message: "Duplicate extraction detected. Please wait a moment before re-uploading the same file."
    });
  }
  recentExtractions.set(extractionKey, now);
  // Clean up old extraction keys
  if (recentExtractions.size > 50) {
    for (const [k, v] of recentExtractions) {
      if (now - v > 60000) recentExtractions.delete(k);
    }
  }

  activeExtractionCount++;
  try {
    const fileName = (file.originalname || '').toLowerCase();
    const buffer = file.buffer;
    let questions = [];

    // A. Handle Excel & CSV Files
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

      questions = rawRows.map((row) => {
        // Safe key lookup (case-insensitive)
        const getVal = (keys) => {
          const foundKey = Object.keys(row).find(k => keys.includes(k.trim().toLowerCase()));
          return foundKey ? String(row[foundKey]).trim() : '';
        };

        return {
          questionText: getVal(['question', 'questiontext', 'question text', 'q']),
          options: {
            A: getVal(['optiona', 'option a', 'a']),
            B: getVal(['optionb', 'option b', 'b']),
            C: getVal(['optionc', 'option c', 'c']),
            D: getVal(['optiond', 'option d', 'd']),
          },
          correctOption: (getVal(['correctoption', 'correct option', 'answer', 'correct answer']) || 'A').toUpperCase().charAt(0)
        };
      }).filter(q => q.questionText !== ''); // Filter empty rows
    }
    // B. Handle Image Files (OCR)
    else if (fileName.match(/\.(png|jpg|jpeg|webp)$/i)) {
      // Step 1: Sharp image pre-processing for better OCR accuracy
      const processedBuffer = await sharp(buffer)
        .grayscale()
        .normalize()
        .sharpen()
        .toBuffer();

      let ocrText = '';
      try {
        const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng', {
          tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : '6'
        });
        ocrText = text || '';
      } catch (ocrError) {
        console.error('[OCR Error] Tesseract failed:', ocrError.message);
        ocrText = '';
      }

      // Step 2: Parse with LLM (if available) or safe local fallback
      questions = await parseRawTextToMCQs(ocrText);
    }
    // C. Handle PDF Files
    else if (fileName.endsWith('.pdf')) {
      const pdfData = await pdfParse(buffer);
      questions = await parseRawTextToMCQs(pdfData.text);
    } else {
      return res.status(400).json({ success: false, message: "Unsupported file extension." });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully extracted ${questions.length} MCQs.`,
      questions
    });
  } catch (error) {
    console.error("Extraction Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to extract questions from file.",
      error: error.message
    });
  } finally {
    activeExtractionCount--;
  }
}

/**
 * Helper to normalize testType strings into canonical enum values ('grand_mock' | 'course_test').
 * Automatically handles variations gracefully (e.g. "Course Test", "course-test", "course_test" -> "course_test").
 * Defaults to "grand_mock" if missing or unrecognized.
 */
function normalizeTestType(input) {
  if (!input || typeof input !== 'string') return 'grand_mock';
  const clean = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (clean === 'course_test' || clean === 'course' || clean.includes('course')) {
    return 'course_test';
  }
  if (clean === 'grand_mock' || clean === 'mock' || clean.includes('grand') || clean.includes('mock')) {
    return 'grand_mock';
  }
  return 'grand_mock';
}

function normalizeExamStatus(input, defaultStatus = 'Published') {
  if (input === undefined || input === null || String(input).trim() === '') return defaultStatus;
  const normalized = String(input).trim().toLowerCase();
  if (normalized === 'draft') return 'Draft';
  if (normalized === 'published') return 'Published';
  return null;
}

/** Resolve and validate a Course Test module against its selected course(s). */
async function resolveCourseTestModule(courseId, courseIds, moduleId) {
  if (!moduleId) return { valid: true, course: null, module: null };

  const selectedIds = Array.isArray(courseIds) && courseIds.length
    ? courseIds
    : (courseId ? [courseId] : []);
  const uniqueIds = [...new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) return { valid: false, message: 'A course must be selected when a module is selected.' };

  const CourseModel = mongoose.models.Course || require('../models/Course');
  const selectedCourses = await Promise.all(uniqueIds.map((id) => {
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    return CourseModel.findOne({
      $or: [
        ...(isObjectId ? [{ _id: id }] : []),
        { courseId: id },
      ],
    });
  }));
  const missing = uniqueIds.filter((_, index) => !selectedCourses[index]);
  if (missing.length) {
    return { valid: false, message: `Course not found for selected course ID(s): ${missing.join(', ')}.` };
  }

  const normalizedModuleId = String(moduleId).trim();
  for (const course of selectedCourses) {
    const module = (course.modules || []).find((item) =>
      String(item._id) === normalizedModuleId || item.moduleName === normalizedModuleId
    );
    if (module) return { valid: true, course, module };
  }
  return { valid: false, message: 'The selected module does not belong to any of the selected courses.' };
}

/** Validate every selected module against the complete selected course set. */
async function resolveCourseTestModules(courseId, courseIds, moduleIds) {
  const ids = [...new Set((Array.isArray(moduleIds) ? moduleIds : [])
    .map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return { valid: true, modules: [] };
  const selectedIds = Array.isArray(courseIds) && courseIds.length
    ? courseIds
    : (courseId ? [courseId] : []);
  const uniqueCourseIds = [...new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!uniqueCourseIds.length) return { valid: false, message: 'A course must be selected when a module is selected.' };
  const CourseModel = mongoose.models.Course || require('../models/Course');
  const courses = await Promise.all(uniqueCourseIds.map((id) => {
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    return CourseModel.findOne({ $or: [...(isObjectId ? [{ _id: id }] : []), { courseId: id }] });
  }));
  if (courses.some((course) => !course)) {
    return { valid: false, message: 'One or more selected courses could not be found.' };
  }
  const modules = [];
  for (const id of ids) {
    let found = null;
    for (const course of courses) {
      found = (course.modules || []).find((item) => String(item._id) === id || item.moduleName === id);
      if (found) break;
    }
    if (!found) return { valid: false, message: `Selected module ${id} does not belong to any selected course.` };
    modules.push(found);
  }
  return { valid: true, modules, courses };
}

function isPublishedForStudents(exam) {
  // Exams created before the status field was introduced retain the historical
  // published behavior instead of disappearing from student access.
  return normalizeExamStatus(exam?.status) === 'Published';
}

function applyStudentPublishedFilter(filter) {
  const publishedFilter = {
    $or: [
      { status: 'Published' },
      { status: 'published' },
      { status: { $exists: false } },
      { status: null },
      { status: '' },
    ],
  };
  filter.$and = [...(filter.$and || []), publishedFilter];
}

/**
 * POST /api/exams/grand-mock
 * Saves the final, verified exam to database.
 */
async function createGrandMockExam(req, res) {
  try {
    const {
      title,
      testType,
      courseId,
      courseIds,
      moduleId,
      moduleIds,
      courseName,
      moduleName,
      marksPerQuestion,
      negativeMark,
      negativeMarks,
      negativeMarkPenalty,
      durationMinutes,
      totalQuestions,
      questions,
      status,
    } = req.body;

    const sanitizedCourseId = (courseId !== undefined && courseId !== null && String(courseId).trim() !== '')
      ? String(courseId).trim()
      : null;
    if (courseIds !== undefined && !Array.isArray(courseIds)) {
      return res.status(400).json({ success: false, message: 'courseIds must be an array of course identifiers.' });
    }
    const sanitizedCourseIds = Array.isArray(courseIds) && courseIds.length > 0
      ? normalizeExamCourseIds(courseIds)
      : normalizeExamCourseIds([], sanitizedCourseId);
    const primaryCourseId = sanitizedCourseId && sanitizedCourseIds.some(
      (id) => id.toLowerCase() === sanitizedCourseId.toLowerCase()
    )
      ? sanitizedCourseId
      : (sanitizedCourseIds[0] || null);

    let finalTestType;
    if (testType && typeof testType === 'string' && testType.trim()) {
      finalTestType = normalizeTestType(testType);
    } else if (sanitizedCourseIds.length > 0) {
      finalTestType = 'course_test';
    } else {
      finalTestType = 'grand_mock';
    }

    const finalStatus = normalizeExamStatus(status);
    if (!finalStatus) {
      return res.status(400).json({
        success: false,
        message: 'status must be either Draft or Published.',
      });
    }

    // Validate required fields
    if (!title || marksPerQuestion === undefined || durationMinutes === undefined || totalQuestions === undefined || !questions) {
      return res.status(400).json({
        success: false,
        message: 'All fields (title, marksPerQuestion, durationMinutes, totalQuestions, questions) are required.'
      });
    }

    if (finalTestType === 'course_test' && sanitizedCourseIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one course must be selected for Course Tests.',
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

    const sanitizedModuleIds = Array.isArray(moduleIds)
      ? [...new Set(moduleIds.map((id) => String(id || '').trim()).filter(Boolean))]
      : (moduleId !== undefined && moduleId !== null && String(moduleId).trim() !== ''
        ? [String(moduleId).trim()] : []);
    const sanitizedModuleId = sanitizedModuleIds[0] || null;

    let resolvedCourseId = primaryCourseId;
    let resolvedCourseName = courseName ? String(courseName).trim() : null;
    if (finalTestType === 'course_test' && sanitizedModuleIds.length && String(primaryCourseId || '').toLowerCase() !== 'unani') {
      const validation = await resolveCourseTestModules(primaryCourseId, sanitizedCourseIds, sanitizedModuleIds);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
      const firstCourse = (validation.courses || []).find((course) =>
        (course.modules || []).some((item) => String(item._id) === sanitizedModuleId || item.moduleName === sanitizedModuleId));
      if (firstCourse) {
        resolvedCourseId = firstCourse.courseId || firstCourse._id.toString();
        if (!resolvedCourseName) resolvedCourseName = firstCourse.courseTitle || null;
      }
    } else if (finalTestType === 'course_test' && sanitizedModuleId && String(primaryCourseId || '').toLowerCase() !== 'unani') {
      const validation = await resolveCourseTestModule(primaryCourseId, sanitizedCourseIds, sanitizedModuleId);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
      if (validation.course) {
        resolvedCourseId = validation.course.courseId || validation.course._id.toString();
        if (!resolvedCourseName) resolvedCourseName = validation.course.courseTitle || null;
      }
    }

    let sanitizedCourseName = resolvedCourseName;
    let sanitizedModuleName = moduleName ? String(moduleName).trim() : null;

    if (resolvedCourseId && (!sanitizedCourseName || !sanitizedModuleName)) {
      try {
        const isObjId = mongoose.Types.ObjectId.isValid(resolvedCourseId);
        const CourseModel = mongoose.models.Course || require('../models/Course');
        const foundCourse = await CourseModel.findOne({
          $or: [
            ...(isObjId ? [{ _id: resolvedCourseId }] : []),
            { courseId: resolvedCourseId }
          ]
        }).lean();

        if (foundCourse) {
          if (!sanitizedCourseName) sanitizedCourseName = foundCourse.courseTitle || foundCourse.title || null;
          if (sanitizedModuleId && !sanitizedModuleName && Array.isArray(foundCourse.modules)) {
            const modObj = foundCourse.modules.find(
              (m) => m && ((m._id && m._id.toString() === sanitizedModuleId) || m.moduleName === sanitizedModuleId)
            );
            if (modObj) {
              sanitizedModuleName = modObj.moduleName || null;
            }
          }
        }
      } catch (err) {
        // Optional lookup failure handled gracefully
      }
    }

    // Create final exam in database
    const newExam = await Exam.create({
      title: title.trim(),
      testType: finalTestType,
      status: finalStatus,
      courseId: resolvedCourseId,
      courseIds: sanitizedCourseIds,
      moduleId: sanitizedModuleId,
      moduleIds: sanitizedModuleIds,
      courseName: sanitizedCourseName,
      moduleName: sanitizedModuleName,
      marksPerQuestion: parsedMarksPerQuestion,
      negativeMark: parsedNegMark,
      negativeMarkPenalty: parsedNegMark,
      durationMinutes: parsedDuration,
      totalQuestions: parsedTotalQuestions,
      questions: questionValidation.questions
    });

    return res.status(201).json({
      success: true,
      message: 'Exam created successfully.',
      exam: newExam
    });
  } catch (error) {
    console.error('Error creating Exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save the Exam to database.',
      error: error.message
    });
  }
}

/**
 * GET /api/exams/grand-mock or /api/exams
 * Fetches exams excluding the questions array for summary list.
 * Supports /api/exams (returns all exams including course tests for admin test history),
 * and /api/exams/grand-mock (returns grand mocks only).
 */
async function getAllGrandMocks(req, res) {
    try {
      const filter = {};
      const reqQuery = req ? (req.query || {}) : {};
      const queryType = reqQuery.testType || reqQuery.type;
      const reqUrl = (req?.originalUrl || req?.baseUrl || req?.path || '').toLowerCase();
      const isGrandMockEndpoint = reqUrl.includes('grand-mock');

      const cleanQueryType = queryType ? String(queryType).trim().toLowerCase().replace(/[\s-]+/g, '_') : null;
      const isExplicitCourseTest = cleanQueryType === 'course_test' || cleanQueryType === 'course';
      const isExplicitGrandMock = cleanQueryType === 'grand_mock' || cleanQueryType === 'mock';

      // Verify student account status if caller is an authenticated student
      if (req.user && req.user.role === 'student') {
        const Student = require('../models/Student');
        const studentId = req.user.studentId || req.user.id || req.user._id;
        let student = null;
        if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
          student = await Student.findOne({
            $or: [
              { _id: new mongoose.Types.ObjectId(studentId) },
              { userId: new mongoose.Types.ObjectId(studentId) }
            ]
          });
        }
        if (!student && req.user.email) {
          student = await Student.findOne({ email: req.user.email.toLowerCase() });
        }

        if (!student) {
          return res.status(403).json({ success: false, message: 'Student profile not found.' });
        }
        if (student.accountStatus && !['Approved', 'Active', 'approved', 'active'].includes(student.accountStatus) &&
          student.status && !['Approved', 'Active', 'approved', 'active'].includes(student.status)) {
          return res.status(403).json({ success: false, message: 'Account is not active or approved.' });
        }
      }

      if (isGrandMockEndpoint || isExplicitGrandMock) {
        // Specifically Grand Mock query
        filter.testType = { $ne: 'course_test' };
        filter.courseId = { $nin: ['unani', 'UNANI', 'Unani'] };
        filter.$or = [
          { testType: 'grand_mock' },
          { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
          { testType: { $exists: false } },
          { testType: null },
          { testType: '' }
        ];
      } else if (isExplicitCourseTest) {
        filter.testType = 'course_test';
        if (reqQuery.courseId && String(reqQuery.courseId).trim()) {
          filter.courseId = String(reqQuery.courseId).trim();
        }
        // For explicit course tests, apply student course filtering if student
        if (req.user && req.user.role === 'student') {
          const Student = require('../models/Student');
          const { getStudentEnrolledCourseIds } = require('../utils/courseAccessHelper');
          const studentId = req.user.studentId || req.user.id || req.user._id;
          let student = null;
          if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
            student = await Student.findOne({
              $or: [
                { _id: new mongoose.Types.ObjectId(studentId) },
                { userId: new mongoose.Types.ObjectId(studentId) }
              ]
            });
          }
          if (!student && req.user.email) {
            student = await Student.findOne({ email: req.user.email.toLowerCase() });
          }

          if (student) {
            // ── Multi-course: collect ALL enrolled course IDs ────────────────────
            const { rawIds, objectIds } = getStudentEnrolledCourseIds(student);
            // Also include from JWT claims (in case DB doc is stale)
            if (Array.isArray(req.user.courseIds)) {
              req.user.courseIds.forEach(id => { const s = String(id || '').trim(); if (s && !rawIds.includes(s)) rawIds.push(s); });
            }

            const courseOrFilter = [];
            if (objectIds.length > 0) courseOrFilter.push({ courseId: { $in: objectIds } });
            if (rawIds.length > 0) {
              courseOrFilter.push({ courseId: { $in: rawIds } });
              const moreObjIds = rawIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
              if (moreObjIds.length > 0) courseOrFilter.push({ courseId: { $in: moreObjIds } });
            }

            if (courseOrFilter.length > 0) {
              if (!filter.courseId) {
                filter.$or = courseOrFilter;
              }
            } else {
              return res.status(200).json({ success: true, count: 0, data: [] });
            }
          }
        }
      } else {
        // General endpoint (e.g. GET /api/exams - Admin test history listing):
        // Returns ALL tests including course tests and grand mocks!
        if (reqQuery.courseId && String(reqQuery.courseId).trim()) {
          filter.courseId = String(reqQuery.courseId).trim();
        } else {
          // Defensive exclusion: Normal test history must never return Unani exams
          filter.courseId = { $nin: ['unani', 'UNANI', 'Unani'] };
        }
        if (req.user && req.user.role === 'student') {
          const Student = require('../models/Student');
          const { getStudentEnrolledCourseIds } = require('../utils/courseAccessHelper');
          const studentId = req.user.studentId || req.user.id || req.user._id;
          let student = null;
          if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
            student = await Student.findOne({
              $or: [
                { _id: new mongoose.Types.ObjectId(studentId) },
                { userId: new mongoose.Types.ObjectId(studentId) }
              ]
            });
          }
          if (!student && req.user.email) {
            student = await Student.findOne({ email: req.user.email.toLowerCase() });
          }

          // ── Multi-course: collect ALL enrolled course IDs ──────────────────────
          const enrolledSource = student || {};
          const { rawIds, objectIds } = getStudentEnrolledCourseIds(enrolledSource);
          // Also include from JWT claims (in case DB doc is stale)
          if (Array.isArray(req.user.courseIds)) {
            req.user.courseIds.forEach(id => { const s = String(id || '').trim(); if (s && !rawIds.includes(s)) rawIds.push(s); });
          }

          const courseOrFilter = [];
          if (objectIds.length > 0) courseOrFilter.push({ courseId: { $in: objectIds } });
          if (rawIds.length > 0) {
            courseOrFilter.push({ courseId: { $in: rawIds } });
            const moreObjIds = rawIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
            if (moreObjIds.length > 0) courseOrFilter.push({ courseId: { $in: moreObjIds } });
          }

          filter.$or = [
            ...courseOrFilter.map(c => ({ ...c, testType: 'course_test' })),
            { testType: 'grand_mock' },
            { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
            { testType: { $exists: false } },
            { testType: null },
            { testType: '' }
          ];
        }
        // For Admins / Staff: no testType restriction, so all tests are returned!
      }

      // Support search query on exam title, courseName & moduleName
      if (reqQuery.search && typeof reqQuery.search === 'string' && reqQuery.search.trim()) {
        const searchStr = reqQuery.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(searchStr, 'i');
        const searchCondition = [
          { title: searchRegex },
          { courseName: searchRegex },
          { moduleName: searchRegex }
        ];
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: searchCondition }];
          delete filter.$or;
        } else {
          filter.$or = searchCondition;
        }
      }

      if (req.user && req.user.role === 'student') {
        applyStudentPublishedFilter(filter);
      }

      // ── Pagination ──
      let page, limit, skip;
      try {
        ({ page, limit, skip } = parsePaginationParams(reqQuery, { defaultLimit: 20 }));
      } catch (pErr) {
        return res.status(pErr.statusCode || 400).json({ success: false, message: pErr.message });
      }

      // Run count + paginated find concurrently
      const [total, exams] = await Promise.all([
        Exam.countDocuments(filter),
        Exam.find(filter)
          .select('-questions')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
      ]);

      const examIds = exams.map(e => e._id);

      // Run attendance aggregation, attempt map, and batch course resolution concurrently
      const TestResult = mongoose.models.TestResult || require('../src/common/models/testResult.model');
      const candidateIds = req.user ? await getStudentCandidateIds(req.user) : [];

      const [attendanceCounts, attemptMap, courseMap] = await Promise.all([
        TestResult.aggregate([
          { $match: { examId: { $in: examIds } } },
          { $group: { _id: { examId: '$examId', studentId: '$studentId' } } },
          { $group: { _id: '$_id.examId', studentsAttended: { $sum: 1 } } }
        ]),
        candidateIds.length > 0
          ? getStudentExamAttemptMap(candidateIds, examIds)
          : Promise.resolve(new Map()),
        batchResolveCourseNames(exams)
      ]);

      const countMap = {};
      attendanceCounts.forEach(item => {
        countMap[item._id.toString()] = item.studentsAttended;
      });

      const formattedExams = exams.map((exam) => {
        let courseName = exam.courseName || null;
        let moduleName = exam.moduleName || null;
        const rawCourseId = exam.courseId ? (typeof exam.courseId === 'object' && exam.courseId._id ? exam.courseId._id.toString() : exam.courseId.toString()).trim() : '';
        const courseIdStr = (rawCourseId && rawCourseId !== 'null' && rawCourseId !== 'undefined') ? rawCourseId : null;
        const rawModuleId = exam.moduleId ? (typeof exam.moduleId === 'object' && exam.moduleId._id ? exam.moduleId._id.toString() : exam.moduleId.toString()).trim() : '';
        const moduleIdStr = (rawModuleId && rawModuleId !== 'null' && rawModuleId !== 'undefined') ? rawModuleId : null;

        // Resolve from batch map instead of N+1 query
        if (courseIdStr && (!courseName || !moduleName)) {
          const foundCourse = courseMap.get(courseIdStr);
          if (foundCourse) {
            if (!courseName) courseName = foundCourse.courseTitle || foundCourse.title || foundCourse.name || null;
            if (moduleIdStr && !moduleName && Array.isArray(foundCourse.modules)) {
              const modObj = foundCourse.modules.find(
                (m) => m && ((m._id && m._id.toString() === moduleIdStr) || m.moduleName === moduleIdStr)
              );
              if (modObj) moduleName = modObj.moduleName || null;
            }
          }
        }

        let normalizedType = exam.testType ? normalizeTestType(exam.testType) : null;
        if (!normalizedType || normalizedType === 'grand_mock') {
          if (courseIdStr && (exam.testType === 'course_test' || !exam.testType)) {
            normalizedType = 'course_test';
          }
        }
        if (!normalizedType) {
          normalizedType = courseIdStr ? 'course_test' : 'grand_mock';
        }

        const finalCourseName = courseName || exam.courseName || null;
        const finalModuleName = moduleName || exam.moduleName || null;
        const resolvedTotalQuestions = exam.totalQuestions !== undefined && exam.totalQuestions !== null
          ? exam.totalQuestions
          : (Array.isArray(exam.questions) ? exam.questions.length : 0);

        const resultsForExam = attemptMap.get(exam._id.toString()) || [];
        const metrics = computeExamAttemptMetrics(exam, resultsForExam);

        return {
          ...exam,
          courseId: courseIdStr,
          courseName: finalCourseName,
          moduleId: moduleIdStr,
          moduleName: finalModuleName,
          testType: normalizedType,
          totalQuestions: resolvedTotalQuestions,
          questionsCount: resolvedTotalQuestions,
          durationMinutes: exam.durationMinutes ?? 0,
          marksPerQuestion: exam.marksPerQuestion ?? 1,
          negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
            ? exam.negativeMark
            : (exam.negativeMarkPenalty ?? 0),
          negativeMarkPenalty: exam.negativeMarkPenalty !== undefined && exam.negativeMarkPenalty !== null
            ? exam.negativeMarkPenalty
            : (exam.negativeMark ?? 0),
          status: normalizeExamStatus(exam.status),
          attemptStatus: metrics.attemptStatus,
          hasAttempted: metrics.hasAttempted,
          isCompleted: metrics.isCompleted,
          previousScore: metrics.previousScore,
          score: metrics.score,
          lastAttemptedAt: metrics.lastAttemptedAt,
          submittedAt: metrics.submittedAt,
          resultId: metrics.resultId,
          course: courseIdStr ? {
            _id: courseIdStr,
            id: courseIdStr,
            courseTitle: finalCourseName || '',
            title: finalCourseName || '',
            name: finalCourseName || ''
          } : null,
          studentsAttended: countMap[exam._id.toString()] || 0
        };
      });

      const pagination = buildPaginationResponse(total, page, limit);

      return res.status(200).json({
        success: true,
        count: formattedExams.length,
        data: formattedExams,
        pagination
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
   * GET /api/admin/exams/:examId/results
   * Admin-only academic result list for one Exam document. This is intentionally
   * read-only: it never creates an attempt/result when the Admin opens it.
   */
  async function getAdminExamResults(req, res) {
    try {
      const { examId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(examId)) {
        return res.status(400).json({ success: false, message: 'Invalid Exam ID format.' });
      }

      const exam = await Exam.findById(examId)
        .select('_id title testType courseId courseName moduleId moduleName status marksPerQuestion negativeMark negativeMarkPenalty durationMinutes totalQuestions questions')
        .lean();
      if (!exam || String(exam.courseId || '').trim().toLowerCase() === 'unani') {
        return res.status(404).json({ success: false, message: 'Academic exam not found.' });
      }

      let page, limit, skip;
      try {
        ({ page, limit, skip } = parsePaginationParams(req.query, { defaultLimit: 20, maxLimit: 100 }));
      } catch (paginationError) {
        return res.status(paginationError.statusCode || 400).json({
          success: false,
          message: paginationError.message,
        });
      }

      const TestResult = mongoose.models.TestResult || require('../src/common/models/testResult.model');
      const Student = mongoose.models.Student || require('../models/Student');
      const User = mongoose.models.User || require('../models/User');
      const resultFilter = { examId: new mongoose.Types.ObjectId(examId) };
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      // Search is resolved to linked Student/User IDs first, then applied to the
      // indexed examId/studentId result query. This avoids per-result lookups.
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escapedSearch, 'i');
        const [matchingStudents, matchingUsers] = await Promise.all([
          Student.find({ $or: [{ name: searchRegex }, { email: searchRegex }] }).select('_id userId').lean(),
          User.find({ $or: [{ name: searchRegex }, { email: searchRegex }] }).select('_id').lean(),
        ]);
        const matchingStudentIds = new Set();
        matchingStudents.forEach((student) => {
          if (student._id) matchingStudentIds.add(student._id.toString());
          if (student.userId) matchingStudentIds.add(student.userId.toString());
        });
        matchingUsers.forEach((user) => {
          if (user._id) matchingStudentIds.add(user._id.toString());
        });
        resultFilter.studentId = {
          $in: [...matchingStudentIds].map((id) => new mongoose.Types.ObjectId(id)),
        };
      }

      const [total, results] = await Promise.all([
        TestResult.countDocuments(resultFilter),
        TestResult.find(resultFilter)
          .select('_id studentId examId score totalMarks totalAttempted totalCorrect totalWrong unansweredQuestions positiveMarks negativeMarks maximumScore percentage status answers createdAt updatedAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const studentIds = [...new Set(results.filter((result) => result.studentId).map((result) => result.studentId.toString()))];
      const resultStudentObjectIds = studentIds.map((id) => new mongoose.Types.ObjectId(id));
      const [students, users] = await Promise.all([
        studentIds.length > 0
          ? Student.find({ $or: [{ _id: { $in: resultStudentObjectIds } }, { userId: { $in: resultStudentObjectIds } }] })
            .select('_id userId name email')
            .lean()
          : Promise.resolve([]),
        studentIds.length > 0
          ? User.find({ _id: { $in: resultStudentObjectIds } }).select('_id name email').lean()
          : Promise.resolve([]),
      ]);

      const studentMap = new Map();
      students.forEach((student) => {
        if (student._id) studentMap.set(student._id.toString(), student);
        if (student.userId) studentMap.set(student.userId.toString(), student);
      });
      const userMap = new Map(users.filter((user) => user._id).map((user) => [user._id.toString(), user]));

      const data = results.map((result) => {
        const resultStudentId = result.studentId ? result.studentId.toString() : null;
        const student = resultStudentId ? studentMap.get(resultStudentId) : null;
        const user = resultStudentId ? userMap.get(resultStudentId) : null;
        return {
          id: result._id.toString(),
          resultId: result._id.toString(),
          studentId: resultStudentId,
          student: {
            id: student?._id?.toString() || resultStudentId,
            name: student?.name || user?.name || '',
            email: student?.email || user?.email || '',
          },
          examId: exam._id.toString(),
          examTitle: exam.title,
          testType: normalizeTestType(exam.testType),
          totalQuestions: exam.totalQuestions ?? (exam.questions || []).length,
          score: result.score ?? 0,
          totalMarks: result.totalMarks ?? 0,
          percentage: result.percentage ?? 0,
          totalAttempted: result.totalAttempted ?? 0,
          totalCorrect: result.totalCorrect ?? 0,
          totalWrong: result.totalWrong ?? 0,
          unansweredQuestions: result.unansweredQuestions ?? 0,
          marksPerQuestion: exam.marksPerQuestion ?? 1,
          negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
            ? exam.negativeMark
            : (exam.negativeMarkPenalty ?? 0),
          positiveMarks: result.positiveMarks ?? ((result.totalCorrect ?? 0) * (exam.marksPerQuestion ?? 1)),
          negativeMarks: result.negativeMarks ?? Math.max(0, ((result.totalCorrect ?? 0) * (exam.marksPerQuestion ?? 1)) - (result.score ?? 0)),
          finalScore: result.score ?? 0,
          maximumScore: result.maximumScore ?? result.totalMarks ?? 0,
          answers: (exam.questions || []).map((question, index) => {
            const answer = (result.answers || []).find((item) =>
              (item.questionId && question._id && item.questionId.toString() === question._id.toString())
            ) || (result.answers || [])[index] || {};
            const correctOption = answer.correctOption || answer.correctAnswer || question?.correctOption || null;
            const selectedOption = answer.selectedOption ?? null;
            return {
              questionId: question?._id || answer.questionId || null,
              questionText: answer.questionText || question?.questionText || '',
              options: answer.options || question?.options || {},
              selectedOption,
              selectedAnswer: answer.selectedAnswer ?? selectedOption,
              selectedOptionText: answer.selectedOptionText || (selectedOption ? question?.options?.[selectedOption] : null) || null,
              correctOption,
              correctAnswer: answer.correctAnswer || correctOption,
              correctOptionText: answer.correctOptionText || (correctOption ? question?.options?.[correctOption] : null) || null,
              isCorrect: answer.isCorrect ?? (selectedOption !== null && selectedOption === correctOption),
              status: answer.status || (selectedOption === null ? 'unanswered' : (selectedOption === correctOption ? 'correct' : 'wrong')),
            };
          }),
          status: result.status || 'Completed',
          submittedAt: result.createdAt,
          updatedAt: result.updatedAt,
        };
      });

      return res.status(200).json({
        success: true,
        exam: {
          id: exam._id.toString(),
          title: exam.title,
          testType: normalizeTestType(exam.testType),
          status: normalizeExamStatus(exam.status),
        },
        data,
        count: data.length,
        pagination: buildPaginationResponse(total, page, limit),
      });
    } catch (error) {
      console.error('Error fetching academic exam results:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch exam results.', error: error.message });
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

      if (req.user && req.user.role === 'student' && !isPublishedForStudents(exam)) {
        return res.status(404).json({ success: false, message: 'Grand Mock Exam not found.' });
      }

      const { courseName, moduleName } = await resolveCourseAndModuleNames(exam);

      // Add student authorization filter
      if (req.user && req.user.role === 'student') {
        const Student = require('../models/Student');
        const studentId = req.user.studentId || req.user.id || req.user._id;
        let student = null;
        if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
          student = await Student.findOne({
            $or: [
              { _id: new mongoose.Types.ObjectId(studentId) },
              { userId: new mongoose.Types.ObjectId(studentId) }
            ]
          });
        }
        if (!student && req.user.email) {
          student = await Student.findOne({ email: req.user.email.toLowerCase() });
        }

        if (!student) {
          return res.status(403).json({ success: false, message: 'Student profile not found.' });
        }
        if (student.accountStatus && !['Approved', 'Active', 'approved', 'active'].includes(student.accountStatus) &&
          student.status && !['Approved', 'Active', 'approved', 'active'].includes(student.status)) {
          return res.status(403).json({ success: false, message: 'Account is not active or approved.' });
        }

        // Only verify course access if this exam is explicitly a course test
        if (normalizeTestType(exam.testType) === 'course_test') {
          const hasAccess = await verifyStudentCourseAccessAny(req.user, getExamAssignedCourseIds(exam));
          if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this exam.' });
          }
        }
      }

      const rawCourseId = exam.courseId ? (typeof exam.courseId === 'object' && exam.courseId._id ? exam.courseId._id.toString() : exam.courseId.toString()).trim() : '';
      const courseIdStr = (rawCourseId && rawCourseId !== 'null' && rawCourseId !== 'undefined') ? rawCourseId : null;
      const rawModuleId = exam.moduleId ? (typeof exam.moduleId === 'object' && exam.moduleId._id ? exam.moduleId._id.toString() : exam.moduleId.toString()).trim() : '';
      const moduleIdStr = (rawModuleId && rawModuleId !== 'null' && rawModuleId !== 'undefined') ? rawModuleId : null;

      let normalizedType = exam.testType ? normalizeTestType(exam.testType) : null;
      if (!normalizedType || normalizedType === 'grand_mock') {
        if (courseIdStr && (exam.testType === 'course_test' || !exam.testType)) {
          normalizedType = 'course_test';
        }
      }
      if (!normalizedType) {
        normalizedType = courseIdStr ? 'course_test' : 'grand_mock';
      }

      if ((req.user?.role || '').toLowerCase().trim() === 'student') {
        const examStatus = exam.status === undefined || exam.status === null || String(exam.status).trim() === ''
          ? 'published'
          : String(exam.status).trim().toLowerCase();
        if (examStatus !== 'published') {
          return res.status(404).json({ success: false, message: 'Exam not found.' });
        }
        if (normalizedType === 'course_test') {
          const assignedCourseIds = getExamAssignedCourseIds(exam);
          if (assignedCourseIds.length === 0) {
            return res.status(404).json({ success: false, message: 'Course Test not found.' });
          }
          const hasCourseAccess = await verifyStudentCourseAccessAny(req.user, assignedCourseIds);
          if (!hasCourseAccess) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this exam.' });
          }
        }
      }

      const finalCourseName = courseName || exam.courseName || null;
      const finalModuleName = moduleName || exam.moduleName || null;
      const resolvedTotalQuestions = exam.totalQuestions !== undefined && exam.totalQuestions !== null
        ? exam.totalQuestions
        : (Array.isArray(exam.questions) ? exam.questions.length : 0);

      const formattedQuestions = await Promise.all(
        (exam.questions || []).map(async q => {
          const cOpt = q.correctOption
            ? q.correctOption.toString().toUpperCase()
            : null;
          const formattedQuestion = {
            ...q,
            correctAnswer: cOpt,
            correctOptionText: q.options && cOpt ? q.options[cOpt] : null,
            correctAnswerText: q.options && cOpt ? q.options[cOpt] : null
          };
          if (
            typeof formattedQuestion.imageUrl === 'string' &&
            formattedQuestion.imageUrl.trim()
          ) {
            formattedQuestion.imageUrl = await resolveProfileImageUrl(
              formattedQuestion.imageUrl.trim()
            );
          }
          return req.user?.role === 'student'
            ? sanitizeQuestionForStudent(formattedQuestion)
            : formattedQuestion;
        })
      );

      const candidateIds = req.user ? await getStudentCandidateIds(req.user) : [];
      const attemptMap = candidateIds.length > 0
        ? await getStudentExamAttemptMap(candidateIds, [exam._id])
        : new Map();
      const resultsForExam = attemptMap.get(exam._id.toString()) || [];
      const metrics = computeExamAttemptMetrics(exam, resultsForExam);

      const formattedExam = {
        ...exam,
        questions: formattedQuestions,
        courseId: courseIdStr,
        courseName: finalCourseName,
        moduleId: moduleIdStr,
        moduleName: finalModuleName,
        testType: normalizedType,
        totalQuestions: resolvedTotalQuestions,
        questionsCount: resolvedTotalQuestions,
        durationMinutes: exam.durationMinutes ?? 0,
        marksPerQuestion: exam.marksPerQuestion ?? 1,
        negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
          ? exam.negativeMark
          : (exam.negativeMarkPenalty ?? 0),
        negativeMarkPenalty: exam.negativeMarkPenalty !== undefined && exam.negativeMarkPenalty !== null
          ? exam.negativeMarkPenalty
          : (exam.negativeMark ?? 0),
        status: normalizeExamStatus(exam.status),
        attemptStatus: metrics.attemptStatus,
        hasAttempted: metrics.hasAttempted,
        isCompleted: metrics.isCompleted,
        previousScore: metrics.previousScore,
        score: metrics.score,
        lastAttemptedAt: metrics.lastAttemptedAt,
        submittedAt: metrics.submittedAt,
        resultId: metrics.resultId,
        course: courseIdStr ? {
          _id: courseIdStr,
          id: courseIdStr,
          courseTitle: finalCourseName || '',
          title: finalCourseName || '',
          name: finalCourseName || ''
        } : null
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
      const hasCourseIdsUpdate = Object.prototype.hasOwnProperty.call(req.body, 'courseIds');
      const isCourseTestUpdate = normalizeTestType(req.body.testType || exam.testType) === 'course_test';
      if (hasCourseIdsUpdate && isCourseTestUpdate && !Array.isArray(req.body.courseIds)) {
        return res.status(400).json({ success: false, message: 'courseIds must be an array of course identifiers.' });
      }

      if (req.body.title !== undefined) updates.title = req.body.title.trim();
      if (req.body.testType !== undefined && req.body.testType !== null && req.body.testType !== '') {
        updates.testType = normalizeTestType(req.body.testType);
      }
      if (req.body.status !== undefined) {
        const normalizedStatus = normalizeExamStatus(req.body.status, null);
        if (!normalizedStatus) {
          return res.status(400).json({ success: false, message: 'status must be either Draft or Published.' });
        }
        updates.status = normalizedStatus;
      }
      if (hasCourseIdsUpdate && isCourseTestUpdate) {
        updates.courseIds = normalizeExamCourseIds(req.body.courseIds);
        const requestedPrimaryCourseId = req.body.courseId !== undefined && req.body.courseId !== null
          ? String(req.body.courseId).trim()
          : '';
        updates.courseId = updates.courseIds.find((id) => id.toLowerCase() === requestedPrimaryCourseId.toLowerCase())
          || updates.courseIds[0]
          || null;
      } else if (req.body.courseId !== undefined) {
        updates.courseId = (req.body.courseId !== null && String(req.body.courseId).trim() !== '')
          ? String(req.body.courseId).trim()
          : null;
        if (isCourseTestUpdate) updates.courseIds = updates.courseId ? [updates.courseId] : [];
      }
      if (req.body.moduleId !== undefined) {
        updates.moduleId = (req.body.moduleId !== null && String(req.body.moduleId).trim() !== '')
          ? String(req.body.moduleId).trim()
          : null;
      }
      if (req.body.courseIds !== undefined) {
        if (!Array.isArray(req.body.courseIds)) {
          return res.status(400).json({ success: false, message: 'courseIds must be an array.' });
        }
        updates.courseIds = [...new Set(req.body.courseIds
          .map((value) => String(value || '').trim()).filter(Boolean))];
      }
      if (req.body.moduleIds !== undefined) {
        if (!Array.isArray(req.body.moduleIds)) {
          return res.status(400).json({ success: false, message: 'moduleIds must be an array.' });
        }
        updates.moduleIds = [...new Set(req.body.moduleIds
          .map((value) => String(value || '').trim()).filter(Boolean))];
        updates.moduleId = updates.moduleIds[0] || null;
      } else if (req.body.moduleId !== undefined) {
        updates.moduleIds = updates.moduleId ? [updates.moduleId] : [];
      }
      if (req.body.courseName !== undefined) {
        updates.courseName = req.body.courseName ? String(req.body.courseName).trim() : null;
      }
      if (req.body.moduleName !== undefined) {
        updates.moduleName = req.body.moduleName ? String(req.body.moduleName).trim() : null;
      }
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

      const effectiveTestType = updates.testType || exam.testType;
      const effectiveCourseId = Object.prototype.hasOwnProperty.call(updates, 'courseId') ? updates.courseId : exam.courseId;
      const effectiveModuleIds = Object.prototype.hasOwnProperty.call(updates, 'moduleIds')
        ? updates.moduleIds
        : (Array.isArray(exam.moduleIds) && exam.moduleIds.length ? exam.moduleIds : (exam.moduleId ? [exam.moduleId] : []));
      const effectiveCourseIds = Object.prototype.hasOwnProperty.call(updates, 'courseIds')
        ? updates.courseIds
        : getExamAssignedCourseIds({ courseIds: exam.courseIds, courseId: effectiveCourseId });

      if (normalizeTestType(effectiveTestType) === 'course_test' && effectiveCourseIds.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one course must be selected for Course Tests.' });
      }

      if (normalizeTestType(effectiveTestType) === 'course_test' && effectiveModuleIds.length && String(effectiveCourseId || '').toLowerCase() !== 'unani') {
        const validation = await resolveCourseTestModules(effectiveCourseId, effectiveCourseIds, effectiveModuleIds);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const firstModule = (validation.modules || [])[0];
        if (firstModule) {
          const moduleCourse = (validation.courses || []).find((course) =>
            (course.modules || []).some((item) => String(item._id) === String(firstModule._id) || item.moduleName === firstModule.moduleName));
          if (moduleCourse) {
            updates.courseId = moduleCourse.courseId || moduleCourse._id.toString();
            if (!updates.courseName && moduleCourse.courseTitle) updates.courseName = moduleCourse.courseTitle;
          }
          if (!updates.moduleName) updates.moduleName = firstModule.moduleName || null;
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
        qSubDoc.explanation = validation.question.explanation;

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
    const createExam = createGrandMockExam;
    const saveGrandMock = createGrandMockExam;
    const getExamById = getGrandMockById;

    module.exports = {
      extractMCQs,
      createGrandMockExam,
      createExam,
      saveGrandMock,
      getAllGrandMocks,
      getAdminExamResults,
      getGrandMockById,
      getExamById,
      updateGrandMockExam,
      deleteGrandMockExam,
      deleteExam,
      addQuestionToExam,
      updateQuestionInExam,
      deleteQuestionFromExam,
      validateAndSanitizeQuestion,
      validateAndSanitizeQuestions,
      normalizeTestType,
      parseRawTextToMCQs,
      parseMCQText: parseRawTextToMCQs // Exported for test verification
    };
