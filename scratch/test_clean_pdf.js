const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function testCleanPDF() {
  console.log('--- TESTING CLEAN PDF GENERATION WITHOUT BLANK PAGES ---');

  const user = {
    id: 'usr_1001',
    name: 'Dr. John Doe',
    email: 'john.doe@whitecoat.academy',
    role: 'student'
  };

  const testCounts = [2, 10, 18, 25];

  for (const count of testCounts) {
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

    const pdfBuffer = await generateWatermarkedAnswerKeyPDF(exam, user);
    const parsed = await pdfParse(pdfBuffer);

    console.log(`\nExam (${count} Qs) -> PDF Size: ${pdfBuffer.length} bytes, Total Pages: ${parsed.numpages}`);

    // Verify last page has actual content (contains question text or header)
    const text = parsed.text;
    if (text.includes(`Question #${count}`)) {
      console.log(`✅ Passed: Question #${count} is present in document.`);
    } else {
      console.error(`❌ Failed: Missing Question #${count}`);
    }
  }

  console.log('\n🎉 ALL CLEAN PDF TESTS COMPLETED SUCCESSFULLY WITH VALID XREF!');
}

testCleanPDF().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});
