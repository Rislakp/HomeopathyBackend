const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function testPerfect() {
  const user = {
    id: 'usr_1001',
    name: 'Dr. John Doe',
    email: 'john.doe@whitecoat.academy',
    role: 'student'
  };

  const testCounts = [2, 15, 25];

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

    console.log(`Exam (${count} Qs) -> PDF Size: ${pdfBuffer.length} bytes, Total Pages: ${parsed.numpages}`);
  }
}

testPerfect().catch(console.error);
