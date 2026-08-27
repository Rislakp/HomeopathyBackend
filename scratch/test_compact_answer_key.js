const path = require('path');
const fs = require('fs');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function runTests() {
  console.log('--- TESTING COMPACT WATERMARKED ANSWER KEY (CORRECT ANSWERS ONLY & NO BLANK PAGES) ---');

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
        correctOption: 'B',
        explanation: 'Dr. Samuel Hahnemann founded homeopathy in 1796.'
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

  // Test 1: Small Exam
  console.log('Test 1: Generating compact PDF buffer for 2 questions...');
  const pdfBuffer1 = await generateWatermarkedAnswerKeyPDF(mockExam, mockUser);
  console.log(`PDF 1 Buffer Size: ${pdfBuffer1.length} bytes`);

  const outputPath1 = path.join(__dirname, 'output_answer_key_compact.pdf');
  fs.writeFileSync(outputPath1, pdfBuffer1);
  console.log(`Saved Test 1 PDF to: ${outputPath1}`);

  // Test 2: Large Exam with 30 questions to test page flow
  console.log('\nTest 2: Generating compact PDF buffer for 30 questions...');
  const largeQuestions = [];
  for (let i = 1; i <= 30; i++) {
    largeQuestions.push({
      _id: `q_${i}`,
      questionText: `Question ${i}: What is the primary characteristic indication for remedy #${i}?`,
      options: {
        A: `Incorrect option A for Q${i}`,
        B: `Correct answer text for Q${i}`,
        C: `Incorrect option C for Q${i}`,
        D: `Incorrect option D for Q${i}`
      },
      correctOption: 'B'
    });
  }

  const largeMockExam = {
    ...mockExam,
    title: 'Comprehensive Homoeopathic Materia Medica 30Q Mock',
    totalQuestions: 30,
    questions: largeQuestions
  };

  const pdfBuffer2 = await generateWatermarkedAnswerKeyPDF(largeMockExam, mockUser);
  console.log(`PDF 2 Buffer Size: ${pdfBuffer2.length} bytes`);

  const outputPath2 = path.join(__dirname, 'output_answer_key_30q.pdf');
  fs.writeFileSync(outputPath2, pdfBuffer2);
  console.log(`Saved Test 2 PDF to: ${outputPath2}`);

  console.log('\n🎉 ALL COMPACT ANSWER KEY PDF TESTS COMPLETED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test Error:', err);
  process.exit(1);
});
