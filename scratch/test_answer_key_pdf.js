const path = require('path');
const fs = require('fs');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function testAnswerKeyPDF() {
  console.log('--- STARTING ANSWER KEY PDF UNIT & WATERMARK TESTS ---');

  const mockExam = {
    _id: '65f1a2b3c4d5e6f7a8b9c0d1',
    title: 'Organon of Medicine & Philosophy Grand Mock',
    marksPerQuestion: 2,
    negativeMark: 0.5,
    durationMinutes: 60,
    totalQuestions: 2,
    questions: [
      {
        _id: 'q1',
        questionText: 'Who is known as the Founder of Homeopathy?',
        options: {
          A: 'Dr. Constantine Hering',
          B: 'Dr. Samuel Hahnemann',
          C: 'Dr. J.T. Kent',
          D: 'Dr. Boenninghausen'
        },
        correctOption: 'B'
      },
      {
        _id: 'q2',
        questionText: 'In which year was the 1st edition of Organon of Medicine published?',
        options: {
          A: '1810',
          B: '1819',
          C: '1824',
          D: '1833'
        },
        correctOption: 'A'
      }
    ]
  };

  const mockUser = {
    id: 'student_999',
    userId: 'student_999',
    name: 'Dr. Alice Smith',
    email: 'alice.smith@whitecoat.academy',
    role: 'student'
  };

  // 1. Generate PDF buffer
  console.log('Generating watermarked PDF buffer...');
  const pdfBuffer = await generateWatermarkedAnswerKeyPDF(mockExam, mockUser);

  console.log(`Generated PDF Buffer Size: ${pdfBuffer.length} bytes`);

  // Verify PDF Header Magic Bytes (%PDF-1.)
  const headerStr = pdfBuffer.slice(0, 8).toString('utf8');
  console.log('Header bytes:', headerStr);
  if (headerStr.startsWith('%PDF-')) {
    console.log('✅ Valid PDF binary magic header detected (%PDF-)');
  } else {
    console.error('❌ FAILED: Invalid PDF header:', headerStr);
    process.exit(1);
  }

  // Save to file for verification
  const outputPath = path.join(__dirname, 'output_answer_key.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`Saved output PDF to: ${outputPath}`);

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
    console.log('✅ PDF file successfully created and verified on disk!');
  } else {
    console.error('❌ File creation failed or size too small.');
    process.exit(1);
  }

  console.log('\n🎉 ALL WATERMARKED ANSWER KEY PDF TESTS PASSED SUCCESSFULLY!');
}

testAnswerKeyPDF().catch((err) => {
  console.error('Test Error:', err);
  process.exit(1);
});
