const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Exam = require('../common/models/exam.model');
const User = require('../../models/User');
const Student = require('../../models/Student');

/**
 * Generates a watermarked answer key PDF buffer for a given exam and user.
 * 
 * @param {Object} exam - The exam document from DB containing questions and metadata.
 * @param {Object} user - The requesting user object ({ id, name, email, role }).
 * @returns {Promise<Buffer>} - Resolves to the PDF binary buffer.
 */
function generateWatermarkedAnswerKeyPDF(exam, user) {
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
      doc.fillColor('#2B6CB0')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text('OFFICIAL EXAM ANSWER KEY & EXPLANATIONS', { align: 'center' });

      doc.moveDown(0.5);
      
      // Horizontal Divider Line
      doc.strokeColor('#CBD5E0')
         .lineWidth(1)
         .moveTo(MARGIN, doc.y)
         .lineTo(PAGE_WIDTH - MARGIN, doc.y)
         .stroke();

      doc.moveDown(0.8);

      // Exam Metadata Box
      const metaStartY = doc.y;
      doc.rect(MARGIN, metaStartY, CONTENT_WIDTH, 70)
         .fillAndStroke('#EDF2F7', '#CBD5E0');

      doc.fillColor('#2D3748')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(`Exam Title: ${exam.title || 'Untitled Exam'}`, MARGIN + 10, metaStartY + 10, { width: CONTENT_WIDTH - 20 });

      const totalQs = (exam.questions && exam.questions.length) || exam.totalQuestions || 0;
      const marksPerQ = exam.marksPerQuestion || 1;
      const negMark = exam.negativeMark !== undefined && exam.negativeMark !== null
        ? exam.negativeMark
        : (exam.negativeMarkPenalty ?? 0);
      const duration = exam.durationMinutes ? `${exam.durationMinutes} mins` : 'N/A';

      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('#4A5568')
         .text(`Total Questions: ${totalQs}   |   Marks per Question: ${marksPerQ}   |   Negative Mark: -${negMark}   |   Duration: ${duration}`, MARGIN + 10, metaStartY + 30);

      const userName = user.name || 'Student';
      const userEmail = user.email || 'N/A';
      const userId = user.id || user.userId || 'N/A';
      const issueDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

      doc.text(`Issued To: ${userName} (${userEmail})   |   ID: ${userId}   |   Generated: ${issueDate}`, MARGIN + 10, metaStartY + 48);

      doc.y = metaStartY + 85;

      // ── Questions & Answers Section (All Options Displayed + Highlighted Correct Answer) ─
      const questions = exam.questions || [];

      if (questions.length === 0) {
        doc.fillColor('#718096')
           .fontSize(11)
           .font('Helvetica-Oblique')
           .text('No questions found for this exam.', MARGIN, doc.y);
      } else {
        questions.forEach((q, index) => {
          const correctKey = (q.correctOption || '').toString().trim().toUpperCase();
          const options = q.options || {};
          const explanation = (q.explanation || q.explanationText || '').trim();

          // Only create a new page if current Y position exceeds threshold
          if (doc.y > BOTTOM_MARGIN_THRESHOLD) {
            doc.addPage();
            doc.y = MARGIN + 25; // Content top position on Page 2+ (leaving space for running header)
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
            if (optionText !== undefined && optionText !== null) {
              const isCorrect = key === correctKey;

              if (isCorrect) {
                // Highlighted Correct Answer (Bold Green text with checkmark indicator)
                doc.fillColor('#22543D')
                   .fontSize(9.5)
                   .font('Helvetica-Bold')
                   .text(`   [✓] Option ${key}: ${optionText}   (CORRECT ANSWER)`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              } else {
                // Standard Choice Option
                doc.fillColor('#4A5568')
                   .fontSize(9.5)
                   .font('Helvetica')
                   .text(`   [  ] Option ${key}: ${optionText}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
              }
              doc.moveDown(0.2);
            }
          });

          // 3. Optional Explanation
          if (explanation) {
            doc.moveDown(0.15);
            doc.fillColor('#2B6CB0')
               .fontSize(9)
               .font('Helvetica-Oblique')
               .text(`   Explanation: ${explanation}`, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 10 });
          }

          // Space between questions (except after final question)
          if (index < questions.length - 1) {
            doc.moveDown(0.45);
          }
        });
      }

      // ── Post-Processing Loop: Headers, Watermarks & Footers on EVERY Page ────────
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      const watermarkText = `WHITE COAT ACADEMY   •   ${userName.toUpperCase()}   •   ${userEmail}   •   ID: ${userId}`;

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

        // 2. Diagonal Semi-Transparent Watermark across page center
        doc.save();
        doc.opacity(0.14);
        doc.fillColor('#4A5568');
        doc.fontSize(13);
        doc.font('Helvetica-Bold');

        const centerX = PAGE_WIDTH / 2;
        const centerY = PAGE_HEIGHT / 2;

        doc.rotate(-45, { origin: [centerX, centerY] });
        doc.text(watermarkText, centerX - 300, centerY, {
          width: 600,
          align: 'center'
        });
        doc.restore();

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
 * Controller handler: Download Watermarked Answer Key PDF
 * Route: GET or POST /api/student/exams/:id/answer-key/download
 * Security: Bearer Token Auth (Student / Admin / Superadmin)
 */
async function downloadAnswerKey(req, res) {
  try {
    const { id } = req.params;

    // 1. Validate Exam ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    // 2. Fetch Exam with questions and answer key
    const exam = await Exam.findById(id).lean();
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found.'
      });
    }

    // 3. Obtain User details from req.user (or query DB as fallback)
    let userDetails = {
      id: req.user ? (req.user.id || req.user.userId) : null,
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
    const pdfBuffer = await generateWatermarkedAnswerKeyPDF(exam, userDetails);

    // 5. Send PDF with appropriate download headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="answer-key-watermarked.pdf"');
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
  downloadAnswerKey,
  generateWatermarkedAnswerKeyPDF
};
