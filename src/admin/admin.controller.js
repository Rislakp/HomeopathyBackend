const mongoose = require('mongoose');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const xlsx = require('xlsx');
const Exam = require('../../models/Exam');
try { require('../../models/Course'); } catch (e) {}

/**
 * Helper to resolve courseName and moduleName for an exam object (populated or plain).
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
          const CourseModel = mongoose.models.Course || require('../../models/Course');
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

/**
 * POST /api/exams/extract-mcqs
 * Extracts MCQs from uploaded PDF file buffer.
 */
async function extractMCQs(req, res) {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

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
      const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
      questions = parseRawTextToMCQs(text);
    } 
    // C. Handle PDF Files
    else if (fileName.endsWith('.pdf')) {
      const pdfData = await pdfParse(buffer);
      questions = parseRawTextToMCQs(pdfData.text);
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

/**
 * POST /api/exams/grand-mock
 * Saves verified exam document to database.
 */
async function createGrandMockExam(req, res) {
  try {
    const {
      title,
      testType,
      courseId,
      moduleId,
      courseName,
      moduleName,
      marksPerQuestion,
      negativeMark,
      negativeMarks,
      negativeMarkPenalty,
      durationMinutes,
      totalQuestions,
      questions
    } = req.body;

    const sanitizedCourseId = (courseId !== undefined && courseId !== null && String(courseId).trim() !== '')
      ? String(courseId).trim()
      : null;

    let finalTestType;
    if (testType && typeof testType === 'string' && testType.trim()) {
      finalTestType = normalizeTestType(testType);
    } else if (sanitizedCourseId) {
      finalTestType = 'course_test';
    } else {
      finalTestType = 'grand_mock';
    }

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

    const questionValidation = validateAndSanitizeQuestions(questions);
    if (!questionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: questionValidation.error
      });
    }

    const sanitizedModuleId = (moduleId !== undefined && moduleId !== null && String(moduleId).trim() !== '')
      ? String(moduleId).trim()
      : null;

    let sanitizedCourseName = courseName ? String(courseName).trim() : null;
    let sanitizedModuleName = moduleName ? String(moduleName).trim() : null;

    if (sanitizedCourseId && (!sanitizedCourseName || !sanitizedModuleName)) {
      try {
        const isObjId = mongoose.Types.ObjectId.isValid(sanitizedCourseId);
        const CourseModel = mongoose.models.Course || require('../../models/Course');
        const foundCourse = await CourseModel.findOne({
          $or: [
            ...(isObjId ? [{ _id: sanitizedCourseId }] : []),
            { courseId: sanitizedCourseId }
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

    const newExam = await Exam.create({
      title: title.trim(),
      testType: finalTestType,
      courseId: sanitizedCourseId,
      moduleId: sanitizedModuleId,
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
 * Admin screen 1: Fetch summary list without questions.
 * Optionally filters by ?testType=grand_mock or ?testType=course_test (handles query parameter variations gracefully).
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

    if (isGrandMockEndpoint || isExplicitGrandMock) {
      // Grand mock query without requiring courseId
      filter.testType = { $ne: 'course_test' };
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
    } else {
      // General endpoint (e.g. GET /api/exams - Admin test history listing):
      // Returns all tests including course tests and grand mocks!
      if (reqQuery.courseId && String(reqQuery.courseId).trim()) {
        filter.courseId = String(reqQuery.courseId).trim();
      }
    }

    const exams = await Exam.find(filter)
      .select('-questions')
      .sort({ createdAt: -1 })
      .lean();

    let countMap = {};
    try {
      const TestResult = mongoose.models.TestResult || require('../common/models/testResult.model');
      if (TestResult) {
        const examIds = exams.map(e => e._id);
        const attendanceCounts = await TestResult.aggregate([
          { $match: { examId: { $in: examIds } } },
          { $group: { _id: { examId: '$examId', studentId: '$studentId' } } },
          { $group: { _id: '$_id.examId', studentsAttended: { $sum: 1 } } }
        ]);
        attendanceCounts.forEach(item => {
          countMap[item._id.toString()] = item.studentsAttended;
        });
      }
    } catch (aggErr) {
      console.warn('[admin.controller.js] Failed to aggregate attendance counts:', aggErr.message);
    }

    const formattedExams = await Promise.all(exams.map(async (exam) => {
      const { courseName, moduleName } = await resolveCourseAndModuleNames(exam);
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

      const finalCourseName = courseName || exam.courseName || null;
      const finalModuleName = moduleName || exam.moduleName || null;
      const resolvedTotalQuestions = exam.totalQuestions !== undefined && exam.totalQuestions !== null
        ? exam.totalQuestions
        : (Array.isArray(exam.questions) ? exam.questions.length : 0);

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
        course: courseIdStr ? {
          _id: courseIdStr,
          id: courseIdStr,
          courseTitle: finalCourseName || '',
          title: finalCourseName || '',
          name: finalCourseName || ''
        } : null,
        studentsAttended: countMap[exam._id.toString()] || 0
      };
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

    const { courseName, moduleName } = await resolveCourseAndModuleNames(exam);
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

    const finalCourseName = courseName || exam.courseName || null;
    const finalModuleName = moduleName || exam.moduleName || null;
    const resolvedTotalQuestions = exam.totalQuestions !== undefined && exam.totalQuestions !== null
      ? exam.totalQuestions
      : (Array.isArray(exam.questions) ? exam.questions.length : 0);

    const formattedExam = {
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
 * PUT /api/exams/grand-mock/:id or /api/exams/:id
 * Admin: Update an existing Grand Mock Exam's metadata and/or questions.
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
    if (req.body.testType !== undefined && req.body.testType !== null && req.body.testType !== '') {
      updates.testType = normalizeTestType(req.body.testType);
    }
    if (req.body.courseId !== undefined) {
      updates.courseId = req.body.courseId && mongoose.Types.ObjectId.isValid(req.body.courseId) ? req.body.courseId : null;
    }
    if (req.body.moduleId !== undefined) {
      updates.moduleId = req.body.moduleId && mongoose.Types.ObjectId.isValid(req.body.moduleId) ? req.body.moduleId : null;
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
      const TestResult = mongoose.models.TestResult || require('../common/models/testResult.model');
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
const createExam = createGrandMockExam;
const saveGrandMock = createGrandMockExam;
const getExamById = getGrandMockById;

module.exports = {
  extractMCQs,
  createGrandMockExam,
  createExam,
  saveGrandMock,
  getAllGrandMocks,
  getGrandMockById,
  getExamById,
  updateGrandMockExam,
  deleteGrandMockExam,
  deleteExam,
  addQuestionToExam,
  updateQuestionInExam,
  deleteQuestionFromExam,
  validateAndSanitizeQuestion,
  validateAndSanitizeQuestions
};

