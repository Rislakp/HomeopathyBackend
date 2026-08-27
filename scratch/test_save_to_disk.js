const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function testSaveToDisk() {
  console.log('--- TESTING SAVING ALL GENERATED PDFS TO DISK ---');

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

    const pdfBuffer = await generateWatermarkedAnswerKeyPDF(exam, user);
    const fileName = `output_${count}q.pdf`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    console.log(`Saved ${fileName}: Size = ${pdfBuffer.length} bytes, Exists = ${fs.existsSync(filePath)}`);
  }

  console.log('\n🎉 ALL DISK WRITE TESTS COMPLETED SUCCESSFULLY!');
}

testSaveToDisk().catch(console.error);
