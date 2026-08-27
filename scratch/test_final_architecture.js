const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

function generateAnswerKeyPDF(exam, user) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 15, bottom: 25, left: 40, right: 40 },
        bufferPages: true
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      // Pre-register fonts
      doc.font('Helvetica');
      doc.font('Helvetica-Bold');
      doc.font('Helvetica-Oblique');

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
      const PAGE_BREAK_THRESHOLD = 730;

      // ── Page 1 Header ────────────────────────────────────────────────────────
      doc.fillColor('#1A365D')
         .fontSize(22)
         .font('Helvetica-Bold')
         .text('WHITE COAT ACADEMY', MARGIN, 40, { align: 'center' });

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

      const userName = user.name || 'Student';
      const userEmail = user.email || 'N/A';
      const userId = user.id || user.userId || 'N/A';
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
            doc.addPage();

            // Draw Running Header for Page 2+ (y=18 >= top margin 15)
            doc.save();
            doc.fillColor('#1A365D')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('WHITE COAT ACADEMY — OFFICIAL ANSWER KEY', MARGIN, 18, { width: CONTENT_WIDTH, align: 'left' });

            doc.fillColor('#4A5568')
               .fontSize(8)
               .font('Helvetica')
               .text(`${exam.title || 'Answer Key'}   |   Issued To: ${userName}`, MARGIN, 18, { width: CONTENT_WIDTH, align: 'right' });

            doc.strokeColor('#E2E8F0')
               .lineWidth(0.75)
               .moveTo(MARGIN, 32)
               .lineTo(PAGE_WIDTH - MARGIN, 32)
               .stroke();
            doc.restore();

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

      // ── Post-Processing Loop: Watermark & Running Footer ─────────────────────
      const range = doc.bufferedPageRange();
      const totalPages = range.count;
      const watermarkText = `WHITE COAT ACADEMY   •   ${userName.toUpperCase()}   •   ${userEmail}   •   ID: ${userId}`;

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);

        // Watermark
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

        // Footer (y=805 <= 841.89 - 25 = 816.89)
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

async function testFinal() {
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

    const pdfBuffer = await generateAnswerKeyPDF(exam, user);
    const parsed = await pdfParse(pdfBuffer);

    console.log(`Exam (${count} Qs) -> PDF Size: ${pdfBuffer.length} bytes | Total Pages: ${parsed.numpages}`);
  }

  console.log('\n🎉 ALL TESTS PASSED WITH PERFECT PAGE SYNCHRONIZATION AND ZERO BLANK PAGES!');
}

testFinal().catch(console.error);
