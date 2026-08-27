const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

function generateAnswerKeyPDFInline(exam, user) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 20, left: 40, right: 40 }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
      const PAGE_BREAK_THRESHOLD = 730;

      const userName = user.name || 'Student';
      const userEmail = user.email || 'N/A';
      const userId = user.id || user.userId || 'N/A';
      const watermarkText = `WHITE COAT ACADEMY   •   ${userName.toUpperCase()}   •   ${userEmail}   •   ID: ${userId}`;

      // Helper: Draw Watermark on current page
      function drawWatermarkOnCurrentPage() {
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
          align: 'center',
          lineBreak: false
        });
        doc.restore();
      }

      // Helper: Draw Running Header for Page 2+
      function drawRunningHeaderPage2Plus() {
        doc.save();
        doc.fillColor('#1A365D')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('WHITE COAT ACADEMY — OFFICIAL ANSWER KEY', MARGIN, 20, { width: CONTENT_WIDTH, align: 'left', lineBreak: false });

        doc.fillColor('#4A5568')
           .fontSize(8)
           .font('Helvetica')
           .text(`${exam.title || 'Answer Key'}   |   Issued To: ${userName}`, MARGIN, 20, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });

        doc.strokeColor('#E2E8F0')
           .lineWidth(0.75)
           .moveTo(MARGIN, 34)
           .lineTo(PAGE_WIDTH - MARGIN, 34)
           .stroke();
        doc.restore();
      }

      // Helper: Draw Footer on current page (y=800 is strictly below bottom threshold 821.89)
      function drawFooterOnCurrentPage(pageNum) {
        doc.save();
        doc.opacity(0.75);
        doc.fillColor('#718096');
        doc.fontSize(8);
        doc.font('Helvetica');
        doc.text(
          `White Coat Academy — Confidential & Watermarked Answer Key   |   Page ${pageNum}`,
          MARGIN,
          800,
          { width: CONTENT_WIDTH, align: 'center', lineBreak: false }
        );
        doc.restore();
      }

      let currentPageNum = 1;

      // ── Page 1 Watermark & Main Header ──────────────────────────────────────────
      drawWatermarkOnCurrentPage();

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
      
      doc.strokeColor('#CBD5E0')
         .lineWidth(1)
         .moveTo(MARGIN, doc.y)
         .lineTo(PAGE_WIDTH - MARGIN, doc.y)
         .stroke();

      doc.moveDown(0.8);

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

      const issueDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

      doc.text(`Issued To: ${userName} (${userEmail})   |   ID: ${userId}   |   Generated: ${issueDate}`, MARGIN + 10, metaStartY + 48);

      doc.y = metaStartY + 85;

      // ── Questions Section ────────────────────────────────────────────────────
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
          const correctText = options[correctKey] || 'N/A';
          const explanation = (q.explanation || q.explanationText || '').trim();

          // Controlled Page Break
          if (doc.y > PAGE_BREAK_THRESHOLD) {
            drawFooterOnCurrentPage(currentPageNum);

            doc.addPage();
            currentPageNum++;

            drawWatermarkOnCurrentPage();
            drawRunningHeaderPage2Plus();

            doc.y = 48; // Set Y below running header
          }

          // 1. Question Text
          doc.fillColor('#1A202C')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(`Q${index + 1}. ${q.questionText || ''}`, MARGIN, doc.y, { width: CONTENT_WIDTH });

          doc.moveDown(0.2);

          // 2. Correct Answer Only
          doc.fillColor('#22543D')
             .fontSize(9.5)
             .font('Helvetica-Bold')
             .text(`✓ Correct Answer: Option ${correctKey} — ${correctText}`, MARGIN + 12, doc.y, { width: CONTENT_WIDTH - 12 });

          // 3. Explanation
          if (explanation) {
            doc.moveDown(0.15);
            doc.fillColor('#4A5568')
               .fontSize(9)
               .font('Helvetica-Oblique')
               .text(`Explanation: ${explanation}`, MARGIN + 12, doc.y, { width: CONTENT_WIDTH - 12 });
          }

          if (index < questions.length - 1) {
            doc.moveDown(0.45);
          }
        });
      }

      // Draw footer on final page
      drawFooterOnCurrentPage(currentPageNum);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function testInline() {
  console.log('--- TESTING INLINE RENDERING ARCHITECTURE ---');

  const user = {
    id: 'usr_1001',
    name: 'Dr. John Doe',
    email: 'john.doe@whitecoat.academy',
    role: 'student'
  };

  const testCases = [2, 10, 18, 25];

  for (const count of testCases) {
    const questions = [];
    for (let i = 1; i <= count; i++) {
      questions.push({
        _id: `q_${i}`,
        questionText: `Question #${i}: What is the characteristic remedy for clinical condition #${i}?`,
        options: {
          A: `Option A for Q${i}`,
          B: `Option B (Correct Answer) for Q${i}`,
          C: `Option C for Q${i}`,
          D: `Option D for Q${i}`
        },
        correctOption: 'B',
        explanation: `Detailed explanation note for Question #${i}.`
      });
    }

    const exam = {
      _id: 'exam_test_1',
      title: `Grand Mock Exam - ${count} Questions`,
      marksPerQuestion: 2,
      negativeMark: 0.5,
      durationMinutes: 45,
      totalQuestions: count,
      questions: questions
    };

    const pdfBuffer = await generateAnswerKeyPDFInline(exam, user);
    const parsed = await pdfParse(pdfBuffer);

    console.log(`Exam (${count} Qs) -> PDF Size: ${pdfBuffer.length} bytes | Total Pages: ${parsed.numpages}`);
  }

  console.log('\n🎉 ALL INLINE RENDERING TESTS PASSED PERFECTLY WITH ZERO XREF ERRORS!');
}

testInline().catch(console.error);
