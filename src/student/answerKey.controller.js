const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Exam = require('../../models/Exam');
const User = require('../../models/User');
const Student = require('../../models/Student');
const TestResult = require('../common/models/testResult.model');
const { getStudentCandidateIds } = require('../../utils/examAttemptHelper');
const { verifyStudentCourseAccessAny } = require('../../utils/courseAccessHelper');
const { getExamAssignedCourseIds } = require('../../utils/examCourseAssignment');

/**
 * Resolves the filesystem path to the brand logo image asset.
 * Checks multiple relative and project locations so it reliably resolves across dev, test, and production.
 *
 * @returns {string|null} Resolved logo path or null if not found
 */
function getWatermarkLogoPath() {
  const candidates = [
    path.join(__dirname, '../../assets/images/WCA_LOGO.jpg'),
    path.join(__dirname, '../../assets/images/logo.jpg'),
    path.join(__dirname, '../../public/images/WCA_LOGO.jpg'),
    path.join(__dirname, '../../public/images/logo.jpg'),
    path.resolve(__dirname, '../../../student-frontend/assets/images/WCA_LOGO.jpg'),
    path.resolve(__dirname, '../../../Homeopathy/assets/images/WCA_LOGO.jpg'),
    path.resolve(__dirname, '../../../Homeopathy/student_frontend/assets/images/WCA_LOGO.jpg')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Renders a standalone large centered logo background watermark on each page.
 * All text strings ("WHITE COAT ACADEMY", student metadata, etc.) are completely removed.
 *
 * @param {PDFDocument} doc - PDFKit document instance
 * @param {number} [pageWidth=595.28] - Page width in points (default: A4 width)
 * @param {number} [pageHeight=841.89] - Page height in points (default: A4 height)
 * @param {Object|string} [options={}] - Custom options object or customLogoPath string
 * @param {number} [options.opacity=0.10] - Faint opacity (10-15%) so exam text is 100% readable
 * @param {number} [options.size=340] - Large logo width/height in points (~300-360pt)
 * @param {number} [options.angle=0] - Optional rotation angle in degrees (default: 0 for clean upright center)
 * @param {string} [options.logoPath] - Optional override path for brand logo image
 */
function buildPdfWatermark(doc, pageWidth = 595.28, pageHeight = 841.89, options = {}) {
  const customPath = typeof options === 'string' ? options : options?.logoPath;
  const logoPath = customPath || getWatermarkLogoPath();

  if (!logoPath || !fs.existsSync(logoPath)) {
    return;
  }

  const opts = typeof options === 'object' && options !== null ? options : {};
  const opacity = opts.opacity !== undefined ? opts.opacity : 0.10;
  const logoSize = opts.size || 340;
  const angle = opts.angle !== undefined ? opts.angle : 0;

  doc.save();
  doc.opacity(opacity);

  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  if (angle !== 0) {
    doc.rotate(angle, { origin: [centerX, centerY] });
  }

  const startX = centerX - logoSize / 2;
  const startY = centerY - logoSize / 2;

  try {
    doc.image(logoPath, startX, startY, {
      width: logoSize,
      height: logoSize
    });
  } catch (err) {
    console.warn('Unable to embed standalone logo in watermark:', err.message);
  }

  doc.restore();
}

/**
 * Formats a Normal exam's question set and optional TestResult into the Answer Key contract.
 *
 * @param {Object} exam - The Normal Exam document from DB
 * @param {Object|null} [result=null] - The student's TestResult document, or null for master answer key
 * @returns {Object} Standardized answer key structure
 */
function formatNormalAnswerKey(exam, result = null) {
  const questions = exam.questions || [];
  const marksPerQuestion = Number(exam.marksPerQuestion) || 1;
  const negativeMark = Number(
    exam.negativeMark !== undefined && exam.negativeMark !== null
      ? exam.negativeMark
      : (exam.negativeMarkPenalty ?? 0)
  );

  const studentAnswersMap = new Map();
  if (result && Array.isArray(result.answers)) {
    result.answers.forEach((ans, index) => {
      if (ans.questionId) {
        studentAnswersMap.set(ans.questionId.toString(), ans);
      }
      studentAnswersMap.set(`idx_${index}`, ans);
    });
  }

  const mappedQuestions = questions.map((q, index) => {
    const qIdStr = q._id ? q._id.toString() : '';
    const studentAns = (qIdStr ? studentAnswersMap.get(qIdStr) : null) || studentAnswersMap.get(`idx_${index}`) || null;

    const correctKey = (q.correctOption || q.answer || '').toString().trim().toUpperCase();
    const options = q.options || {};
    const explanation = (q.explanation || q.explanationText || '').trim();

    let studentSelected = null;
    let isCorrect = null;
    let status = null;
    let marks = null;

    if (result) {
      if (studentAns) {
        studentSelected = studentAns.selectedOption || studentAns.selectedAnswer || null;
        if (studentSelected !== null && studentSelected !== undefined) {
          studentSelected = String(studentSelected).trim().toUpperCase();
          if (!['A', 'B', 'C', 'D'].includes(studentSelected)) {
            studentSelected = null;
          }
        }

        if (studentAns.isCorrect !== undefined && studentAns.isCorrect !== null) {
          isCorrect = Boolean(studentAns.isCorrect);
        } else {
          isCorrect = Boolean(studentSelected && studentSelected === correctKey);
        }

        status = studentAns.status || (studentSelected == null ? 'unanswered' : (isCorrect ? 'correct' : 'wrong'));
      } else {
        studentSelected = null;
        isCorrect = false;
        status = 'unanswered';
      }

      if (status === 'correct') {
        marks = marksPerQuestion;
      } else if (status === 'wrong') {
        marks = -negativeMark;
      } else {
        marks = 0;
      }
    }

    return {
      questionId: q._id || null,
      questionNumber: index + 1,
      questionText: q.questionText || '',
      passage: q.passage || null,
      imageUrl: q.imageUrl || null,
      tableData: q.tableData || null,
      options: options,
      correctOption: correctKey,
      correctAnswer: correctKey,
      correctOptionText: options[correctKey] || null,
      selectedOption: studentSelected,
      selectedAnswer: studentSelected,
      selectedOptionText: studentSelected ? options[studentSelected] || null : null,
      studentSelectedOption: studentSelected,
      isCorrect: isCorrect,
      status: status,
      marks: marks,
      explanation: explanation
    };
  });

  const totalQuestions = (exam.questions && exam.questions.length) || exam.totalQuestions || 0;
  const totalMaxMarks = totalQuestions * marksPerQuestion;

  return {
    exam: {
      _id: exam._id,
      title: exam.title || '',
      testType: exam.testType || 'grand_mock',
      durationMinutes: exam.durationMinutes || 0,
      totalQuestions: totalQuestions,
      marksPerQuestion: marksPerQuestion,
      negativeMark: negativeMark,
    },
    summary: result ? {
      score: result.score ?? 0,
      totalMarks: result.totalMarks ?? totalMaxMarks,
      totalAttempted: result.totalAttempted ?? 0,
      totalCorrect: result.totalCorrect ?? 0,
      totalWrong: result.totalWrong ?? 0,
      unansweredQuestions: result.unansweredQuestions ?? 0,
      percentage: result.percentage ?? (totalMaxMarks > 0 ? Math.round(((result.score ?? 0) / totalMaxMarks) * 100) : 0),
      status: result.status || 'Completed',
    } : null,
    questions: mappedQuestions
  };
}

/**
 * Generates a watermarked answer key PDF buffer for a given exam, user, and optional result.
 * 
 * @param {Object} exam - The exam document from DB containing questions and metadata.
 * @param {Object} [user={}] - The requesting user object ({ id, name, email, role }).
 * @param {Object|null} [result=null] - The student attempt result (TestResult), if available.
 * @returns {Promise<Buffer>} - Resolves to the PDF binary buffer.
 */
function generateWatermarkedAnswerKeyPDF(exam, user = {}, result = null) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 25, left: 40, right: 40 },
        bufferPages: true // Enables post-processing of all pages for watermarking, headers & footers
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Pre-register fonts on Page 1 to ensure PDFKit embeds font dictionaries cleanly
      doc.font('Helvetica');
      doc.font('Helvetica-Bold');
      doc.font('Helvetica-Oblique');

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
      // Safe threshold for question content flow before manual page break
      const BOTTOM_MARGIN_THRESHOLD = PAGE_HEIGHT - 75;

      // ── Main Page 1 Header Section ──────────────────────────────────────────────
      doc.fillColor('#1A365D')
         .fontSize(22)
         .font('Helvetica-Bold')
         .text('WHITE COAT ACADEMY', MARGIN, MARGIN, { align: 'center' });

      doc.moveDown(0.2);
      const subHeader = result ? 'OFFICIAL EXAM ANSWER KEY & EVALUATION' : 'OFFICIAL EXAM ANSWER KEY & EXPLANATIONS';
      doc.fillColor('#2B6CB0')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text(subHeader, { align: 'center' });

      doc.moveDown(0.5);
      
      // Horizontal Divider Line
      doc.strokeColor('#CBD5E0')
         .lineWidth(1)
         .moveTo(MARGIN, doc.y)
         .lineTo(PAGE_WIDTH - MARGIN, doc.y)
         .stroke();

      doc.moveDown(0.6);

      // Exam Metadata Box
      const metaStartY = doc.y;
      const hasResult = Boolean(result);
      const metaHeight = hasResult ? 88 : 70;

      doc.rect(MARGIN, metaStartY, CONTENT_WIDTH, metaHeight)
         .fillAndStroke('#EDF2F7', '#CBD5E0');

      doc.fillColor('#2D3748')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(`Exam Title: ${exam.title || 'Untitled Exam'}`, MARGIN + 10, metaStartY + 8, { width: CONTENT_WIDTH - 20 });

      const totalQs = (exam.questions && exam.questions.length) || exam.totalQuestions || 0;
      const marksPerQ = Number(exam.marksPerQuestion) || 1;
      const negMark = Number(exam.negativeMark !== undefined && exam.negativeMark !== null
        ? exam.negativeMark
        : (exam.negativeMarkPenalty ?? 0));
      const duration = exam.durationMinutes ? `${exam.durationMinutes} mins` : 'N/A';

      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('#4A5568')
         .text(`Total Questions: ${totalQs}   |   Marks per Question: ${marksPerQ}   |   Negative Mark: -${negMark}   |   Duration: ${duration}`, MARGIN + 10, metaStartY + 26);

      const userName = (user && user.name) || 'Student';
      const userEmail = (user && user.email) || 'N/A';
      const userId = (user && (user.id || user.userId || user.studentId)) || 'N/A';
      const issueDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

      doc.text(`Issued To: ${userName} (${userEmail})   |   ID: ${userId}   |   Generated: ${issueDate}`, MARGIN + 10, metaStartY + 44);

      if (hasResult) {
        const score = result.score ?? 0;
        const totalMarks = result.totalMarks ?? (totalQs * marksPerQ);
        const pct = result.percentage ?? (totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0);
        const correct = result.totalCorrect ?? 0;
        const wrong = result.totalWrong ?? 0;
        const unanswered = result.unansweredQuestions ?? 0;

        doc.fillColor('#1A365D')
           .font('Helvetica-Bold')
           .text(`Evaluation Summary: Score: ${score} / ${totalMarks} (${pct}%)   |   Correct: ${correct}   |   Wrong: ${wrong}   |   Unanswered: ${unanswered}`, MARGIN + 10, metaStartY + 64);
      }

      doc.y = metaStartY + metaHeight + 15;

      // ── Questions & Answers Section ──────────────────────────────────────────
      const questions = exam.questions || [];

      const studentAnswersMap = new Map();
      if (result && Array.isArray(result.answers)) {
        result.answers.forEach((ans, index) => {
          if (ans.questionId) {
            studentAnswersMap.set(ans.questionId.toString(), ans);
          }
          studentAnswersMap.set(`idx_${index}`, ans);
        });
      }

      if (questions.length === 0) {
        doc.fillColor('#718096')
           .fontSize(11)
           .font('Helvetica-Oblique')
           .text('No questions found for this exam.', MARGIN, doc.y);
      } else {
        questions.forEach((q, index) => {
          const correctKey = (q.correctOption || q.answer || '').toString().trim().toUpperCase();
          const options = q.options || {};
          const explanation = (q.explanation || q.explanationText || '').trim();

          const qIdStr = q._id ? q._id.toString() : '';
          const studentAns = (qIdStr ? studentAnswersMap.get(qIdStr) : null) || studentAnswersMap.get(`idx_${index}`) || null;
          let studentOption = studentAns && (studentAns.selectedOption || studentAns.selectedAnswer) ? String(studentAns.selectedOption || studentAns.selectedAnswer).trim().toUpperCase() : null;
          if (studentOption && !['A', 'B', 'C', 'D'].includes(studentOption)) {
            studentOption = null;
          }
          const isStudentAttempted = Boolean(studentOption);
          const isStudentCorrect = studentAns && studentAns.isCorrect !== undefined ? Boolean(studentAns.isCorrect) : (isStudentAttempted && studentOption === correctKey);

          // Only create a new page if current Y position exceeds threshold
          if (doc.y > BOTTOM_MARGIN_THRESHOLD) {
            doc.addPage();
            doc.y = MARGIN + 25; // Content top position on Page 2+
          }

          // 1. Question Number & Text
          doc.fillColor('#1A202C')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(`Q${index + 1}. ${q.questionText || ''}`, MARGIN, doc.y, { width: CONTENT_WIDTH });

          doc.moveDown(0.25);

          // Optional Passage
          if (q.passage) {
            doc.fillColor('#2D3748')
               .fontSize(9)
               .font('Helvetica-Oblique')
               .text(`Passage: ${q.passage}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.25);
          }

          // Optional Image URL
          if (q.imageUrl) {
            doc.fillColor('#4A5568')
               .fontSize(8.5)
               .font('Helvetica')
               .text(`[Image: ${q.imageUrl}]`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.2);
          }

          // Optional Table Data
          if (q.tableData) {
            let tableStr = typeof q.tableData === 'string' ? q.tableData : JSON.stringify(q.tableData);
            doc.fillColor('#4A5568')
               .fontSize(8.5)
               .font('Helvetica-Bold')
               .text(`[Table Data]: ${tableStr}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            doc.moveDown(0.2);
          }

          // 2. Loop through and display all available options (A, B, C, D)
          ['A', 'B', 'C', 'D'].forEach((key) => {
            const optionText = options[key];
            if (optionText !== undefined && optionText !== null && String(optionText).trim() !== '') {
              const isCorrectOption = (key === correctKey);
              const isSelectedOption = (studentOption === key);

              if (hasResult) {
                if (isCorrectOption && isSelectedOption) {
                  doc.fillColor('#22543D')
                     .fontSize(9.5)
                     .font('Helvetica-Bold')
                     .text(`   [✓] Option ${key}: ${optionText}   (CORRECT - YOUR ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                } else if (isCorrectOption) {
                  doc.fillColor('#22543D')
                     .fontSize(9.5)
                     .font('Helvetica-Bold')
                     .text(`   [✓] Option ${key}: ${optionText}   (CORRECT ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                } else if (isSelectedOption) {
                  doc.fillColor('#C53030')
                     .fontSize(9.5)
                     .font('Helvetica-Bold')
                     .text(`   [✗] Option ${key}: ${optionText}   (YOUR ANSWER - INCORRECT)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                } else {
                  doc.fillColor('#4A5568')
                     .fontSize(9.5)
                     .font('Helvetica')
                     .text(`   [  ] Option ${key}: ${optionText}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                }
              } else {
                if (isCorrectOption) {
                  doc.fillColor('#22543D')
                     .fontSize(9.5)
                     .font('Helvetica-Bold')
                     .text(`   [✓] Option ${key}: ${optionText}   (CORRECT ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                } else {
                  doc.fillColor('#4A5568')
                     .fontSize(9.5)
                     .font('Helvetica')
                     .text(`   [  ] Option ${key}: ${optionText}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
                }
              }
              doc.moveDown(0.2);
            }
          });

          // Result line for this question if result present
          if (hasResult) {
            if (isStudentAttempted) {
              if (isStudentCorrect) {
                doc.fillColor('#22543D')
                   .fontSize(8.5)
                   .font('Helvetica-Bold')
                   .text(`   Evaluation: Correct (+${marksPerQ} mark${marksPerQ === 1 ? '' : 's'})`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else {
                doc.fillColor('#C53030')
                   .fontSize(8.5)
                   .font('Helvetica-Bold')
                   .text(`   Evaluation: Incorrect (-${negMark} mark${negMark === 1 ? '' : 's'})`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              }
            } else {
              doc.fillColor('#B7791F')
                 .fontSize(8.5)
                 .font('Helvetica-Oblique')
                 .text('   Evaluation: Not Attempted / Skipped (0 marks)', MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
            }
            doc.moveDown(0.15);
          }

          // 3. Optional Explanation
          if (explanation) {
            doc.fillColor('#2B6CB0')
               .fontSize(9)
               .font('Helvetica-Oblique')
               .text(`   Explanation: ${explanation}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
          }

          // Space between questions (except after final question)
          if (index < questions.length - 1) {
            doc.moveDown(0.4);
          }
        });
      }

      // ── Post-Processing Loop: Headers, Watermarks & Footers on EVERY Page ────────
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);

        // 1. Running Header for Page 2+
        if (i > 0) {
          doc.save();
          doc.fillColor('#1A365D')
             .fontSize(9)
             .font('Helvetica-Bold')
             .text('WHITE COAT ACADEMY — OFFICIAL ANSWER KEY', MARGIN, 20, { width: CONTENT_WIDTH, align: 'left' });

          doc.fillColor('#4A5568')
             .fontSize(8)
             .font('Helvetica')
             .text(`${exam.title || 'Answer Key'}   |   Issued To: ${userName}`, MARGIN, 20, { width: CONTENT_WIDTH, align: 'right' });

          doc.strokeColor('#E2E8F0')
             .lineWidth(0.75)
             .moveTo(MARGIN, 34)
             .lineTo(PAGE_WIDTH - MARGIN, 34)
             .stroke();
          doc.restore();
        }

        // 2. Standalone Large Centered Logo Background Watermark (No Text Strings)
        buildPdfWatermark(doc, PAGE_WIDTH, PAGE_HEIGHT);

        // 3. Running Footer on ALL pages
        doc.save();
        doc.opacity(0.75);
        doc.fillColor('#718096');
        doc.fontSize(8);
        doc.font('Helvetica');
        doc.text(
          `White Coat Academy — Confidential & Watermarked Answer Key   |   Page ${i + 1} of ${totalPages}`,
          MARGIN,
          805,
          { width: CONTENT_WIDTH, align: 'center' }
        );
        doc.restore();
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Controller handler: Retrieve Answer Key JSON for a Normal Exam
 * Routes:
 *   GET /api/student/exams/:id/answer-key
 *   GET /api/student/exams/:id/results/:resultId/answer-key
 *   GET /api/exams/:id/answer-key
 *   GET /api/exams/grand-mock/:id/answer-key
 *   GET /api/exams/:id/results/:resultId/answer-key
 */
async function getAnswerKey(req, res) {
  try {
    const params = req?.params || {};
    const query = req?.query || {};
    const id = params.examId || params.id;
    const resultId = params.resultId || query.resultId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.',
      });
    }

    // Check explicit route or query context
    const baseUrl = req?.baseUrl || '';
    const originalUrl = req?.originalUrl || req?.url || '';
    const isExplicitUnani = Boolean(
      baseUrl.includes('unani') ||
      originalUrl.includes('/unani-exams') ||
      query.system === 'unani' ||
      query.examType === 'unani'
    );
    const isExplicitNormal = Boolean(
      query.system === 'normal' ||
      query.system === 'homeopathy' ||
      query.examType === 'normal'
    );

    if (isExplicitUnani) {
      let unaniExamController;
      try { unaniExamController = require('../unani/exams/controllers/unaniExam.controller'); } catch (e) {}
      if (unaniExamController && typeof unaniExamController.getAnswerKey === 'function') {
        return unaniExamController.getAnswerKey(req, res);
      }
      return res.status(404).json({ success: false, message: 'Unani exam not found.' });
    }

    // Attempt to find Normal exam
    let exam = await Exam.findById(id).lean();
    if (!exam) {
      if (isExplicitNormal) {
        return res.status(404).json({ success: false, message: 'Exam not found.' });
      }

      // Check fallback to UnaniExam on shared endpoint
      let UnaniExam;
      try { UnaniExam = require('../unani/exams/models/unaniExam.model'); } catch (e) {}
      if (UnaniExam) {
        const unaniExam = await UnaniExam.findById(id).lean();
        if (unaniExam) {
          let unaniExamController;
          try { unaniExamController = require('../unani/exams/controllers/unaniExam.controller'); } catch (e) {}
          if (unaniExamController && typeof unaniExamController.getAnswerKey === 'function') {
            return unaniExamController.getAnswerKey(req, res);
          }
        }
      }

      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    // Normal Exam Access Verification
    const role = String(req.user?.role || '').toLowerCase().trim();
    const isAdmin = ['admin', 'superadmin'].includes(role);
    let normalResult = null;

    if (role === 'student') {
      const examStatus = exam.status === undefined || exam.status === null || String(exam.status).trim() === ''
        ? 'published'
        : String(exam.status).trim().toLowerCase();
      if (examStatus !== 'published') {
        return res.status(404).json({ success: false, message: 'Exam not found.' });
      }

      const isCourseTest = String(exam.testType || '').trim().toLowerCase().replace(/[ -]/g, '_') === 'course_test';
      if (isCourseTest) {
        const assignedCourseIds = getExamAssignedCourseIds(exam);
        if (assignedCourseIds.length === 0) {
          return res.status(404).json({ success: false, message: 'Course Test not found.' });
        }
        const hasCourseAccess = await verifyStudentCourseAccessAny(req.user, assignedCourseIds);
        if (!hasCourseAccess) {
          return res.status(403).json({ success: false, message: 'You are not authorized to access this exam.' });
        }
      }

      const candidateIds = await getStudentCandidateIds(req.user);
      if (candidateIds.length === 0) {
        return res.status(401).json({ success: false, message: 'Student identity could not be resolved.' });
      }

      if (resultId) {
        if (!mongoose.Types.ObjectId.isValid(resultId)) {
          return res.status(400).json({ success: false, message: 'Invalid Result ID format.' });
        }
        normalResult = await TestResult.findOne({
          _id: resultId,
          examId: exam._id,
          studentId: { $in: candidateIds },
          status: { $in: ['Completed', 'Attempted'] },
        }).lean();
      } else {
        normalResult = await TestResult.findOne({
          studentId: { $in: candidateIds },
          examId: exam._id,
          status: { $in: ['Completed', 'Attempted'] },
        }).sort({ createdAt: -1 }).lean();
      }

      if (!normalResult) {
        return res.status(403).json({
          success: false,
          message: 'A completed attempt is required to view this answer key.',
        });
      }
    } else if (isAdmin) {
      if (resultId) {
        if (!mongoose.Types.ObjectId.isValid(resultId)) {
          return res.status(400).json({ success: false, message: 'Invalid Result ID format.' });
        }
        normalResult = await TestResult.findOne({
          _id: resultId,
          examId: exam._id,
        }).lean();
        if (!normalResult) {
          return res.status(404).json({ success: false, message: 'Test result not found.' });
        }
      }
    }

    const formattedData = formatNormalAnswerKey(exam, normalResult);
    return res.status(200).json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    console.error('Error retrieving answer key:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve answer key.',
      error: error.message,
    });
  }
}

/**
 * Controller handler: Download Watermarked Answer Key PDF
 * Route: GET or POST /api/student/exams/:id/answer-key/download
 * Security: Bearer Token Auth (Student / Admin / Superadmin)
 */
async function downloadAnswerKey(req, res) {
  try {
    const params = req?.params || {};
    const query = req?.query || {};
    const id = params.examId || params.id;
    const resultId = params.resultId || query.resultId;

    // 1. Validate Exam ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    // Explicit route or query context check
    const baseUrl = req?.baseUrl || '';
    const originalUrl = req?.originalUrl || req?.url || '';
    const isExplicitUnani = Boolean(
      baseUrl.includes('unani') ||
      originalUrl.includes('/unani-exams') ||
      query.system === 'unani' ||
      query.examType === 'unani'
    );
    const isExplicitNormal = Boolean(
      query.system === 'normal' ||
      query.system === 'homeopathy' ||
      query.examType === 'normal'
    );

    if (isExplicitUnani) {
      let unaniExamController;
      try { unaniExamController = require('../unani/exams/controllers/unaniExam.controller'); } catch (e) {}
      if (unaniExamController && typeof unaniExamController.downloadAnswerKeyPDF === 'function') {
        return unaniExamController.downloadAnswerKeyPDF(req, res);
      }
      return res.status(404).json({ success: false, message: 'Unani exam not found.' });
    }

    // 2. Fetch Exam with questions and answer key
    let exam = await Exam.findById(id).lean();
    let isUnani = false;
    let unaniResult = null;

    if (!exam) {
      if (isExplicitNormal) {
        return res.status(404).json({ success: false, message: 'Exam not found.' });
      }

      let UnaniExam;
      try { UnaniExam = require('../unani/exams/models/unaniExam.model'); } catch (e) {}
      if (UnaniExam) {
        exam = await UnaniExam.findById(id).lean();
        if (exam) {
          isUnani = true;
        }
      }
    }

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found.'
      });
    }

    const role = String(req.user?.role || '').toLowerCase().trim();
    const isAdmin = ['admin', 'superadmin'].includes(role);
    let normalResult = null;

    if (role === 'student') {
      if (isUnani) {
        const examStatus = exam.status === undefined || exam.status === null || String(exam.status).trim() === ''
          ? 'published'
          : String(exam.status).trim().toLowerCase();
        if (examStatus !== 'published') {
          return res.status(404).json({ success: false, message: 'Exam not found.' });
        }

        const hasUnaniCourseAccess = await verifyStudentCourseAccessAny(req.user, ['unani']);
        if (!hasUnaniCourseAccess) {
          return res.status(403).json({ success: false, message: 'You are not authorized to access this exam.' });
        }

        const candidateIds = await getStudentCandidateIds(req.user);
        if (candidateIds.length === 0) {
          return res.status(401).json({ success: false, message: 'Student identity could not be resolved.' });
        }

        let UnaniExamResult;
        try { UnaniExamResult = require('../unani/exams/models/unaniExamResult.model'); } catch (e) {}
        if (UnaniExamResult) {
          const resultFilter = {
            studentId: { $in: candidateIds },
            examId: exam._id,
            status: { $in: ['Completed', 'Attempted'] },
          };
          if (resultId && mongoose.Types.ObjectId.isValid(resultId)) {
            resultFilter._id = resultId;
          }
          unaniResult = await UnaniExamResult.findOne(resultFilter).sort({ createdAt: -1 }).lean();
        }

        if (!unaniResult) {
          return res.status(403).json({ success: false, message: 'A completed attempt is required to download this answer key.' });
        }
      } else {
        const examStatus = exam.status === undefined || exam.status === null || String(exam.status).trim() === ''
          ? 'published'
          : String(exam.status).trim().toLowerCase();
        if (examStatus !== 'published') {
          return res.status(404).json({ success: false, message: 'Exam not found.' });
        }

        const isCourseTest = String(exam.testType || '').trim().toLowerCase().replace(/[ -]/g, '_') === 'course_test';
        if (isCourseTest) {
          const assignedCourseIds = getExamAssignedCourseIds(exam);
          if (assignedCourseIds.length === 0) {
            return res.status(404).json({ success: false, message: 'Course Test not found.' });
          }
          const hasCourseAccess = await verifyStudentCourseAccessAny(req.user, assignedCourseIds);
          if (!hasCourseAccess) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this exam.' });
          }
        }

        const candidateIds = await getStudentCandidateIds(req.user);
        if (candidateIds.length === 0) {
          return res.status(401).json({ success: false, message: 'Student identity could not be resolved.' });
        }

        if (resultId) {
          if (!mongoose.Types.ObjectId.isValid(resultId)) {
            return res.status(400).json({ success: false, message: 'Invalid Result ID format.' });
          }
          normalResult = await TestResult.findOne({
            _id: resultId,
            examId: exam._id,
            studentId: { $in: candidateIds },
            status: { $in: ['Completed', 'Attempted'] },
          }).lean();
        } else {
          normalResult = await TestResult.findOne({
            studentId: { $in: candidateIds },
            examId: exam._id,
            status: { $in: ['Completed', 'Attempted'] },
          }).sort({ createdAt: -1 }).lean();
        }

        if (!normalResult) {
          return res.status(403).json({ success: false, message: 'A completed attempt is required to download this answer key.' });
        }
      }
    } else if (isAdmin) {
      if (!isUnani && resultId && mongoose.Types.ObjectId.isValid(resultId)) {
        normalResult = await TestResult.findOne({
          _id: resultId,
          examId: exam._id,
        }).lean();
      }
    }

    // 3. Obtain User details from req.user (or query DB as fallback)
    let userDetails = {
      id: req.user ? (req.user.id || req.user.userId || req.user.studentId) : null,
      name: req.user ? req.user.name : null,
      email: req.user ? req.user.email : null,
      role: req.user ? req.user.role : 'student'
    };

    if (!userDetails.name || !userDetails.email) {
      if (userDetails.id && mongoose.Types.ObjectId.isValid(userDetails.id)) {
        const userDoc = await User.findById(userDetails.id).lean() || await Student.findById(userDetails.id).lean();
        if (userDoc) {
          userDetails.name = userDetails.name || userDoc.name;
          userDetails.email = userDetails.email || userDoc.email;
        }
      }
    }

    userDetails.name = userDetails.name || 'Student';
    userDetails.email = userDetails.email || 'N/A';
    userDetails.id = userDetails.id || 'N/A';

    // 4. Generate Watermarked PDF Buffer
    let pdfBuffer;
    if (isUnani) {
      let unaniExamService;
      try { unaniExamService = require('../unani/exams/services/unaniExam.service'); } catch (e) {}
      if (unaniExamService && typeof unaniExamService.generateUnaniAnswerKeyPDF === 'function') {
        pdfBuffer = await unaniExamService.generateUnaniAnswerKeyPDF(exam, userDetails, unaniResult);
      } else {
        pdfBuffer = await generateWatermarkedAnswerKeyPDF(exam, userDetails, unaniResult);
      }
    } else {
      pdfBuffer = await generateWatermarkedAnswerKeyPDF(exam, userDetails, normalResult);
    }

    // 5. Send PDF with appropriate download headers
    const filename = isUnani ? 'unani-answer-key-watermarked.pdf' : 'answer-key-watermarked.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('Error generating watermarked answer key PDF:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate watermarked answer key PDF.',
      error: error.message
    });
  }
}

module.exports = {
  getAnswerKey,
  downloadAnswerKey,
  formatNormalAnswerKey,
  generateWatermarkedAnswerKeyPDF,
  buildPdfWatermark,
  getWatermarkLogoPath
};
