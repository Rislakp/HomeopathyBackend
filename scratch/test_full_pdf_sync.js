const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');

async function testFullPdfSync() {
  console.log('--- TESTING HEADER/FOOTER SYNCHRONIZATION & BLANK PAGE REMOVAL ---');

  // Test 1: Small Exam (Should be exactly 1 page)
  const smallExam = {
    _id: '65f1a2b3c4d5e6f7a8b9c0d1',
    title: 'Short Quick Quiz',
    marksPerQuestion: 1,
    negativeMark: 0,
    durationMinutes: 15,
    totalQuestions: 2,
    questions: [
      {
        _id: 'q1',
        questionText: 'What is the remedy prepared from Honey Bee?',
        options: { A: 'Apis Mellifica', B: 'Cantharis', C: 'Lachesis', D: 'Rhus Tox' },
        correctOption: 'A'
      },
      {
        _id: 'q2',
        questionText: 'What is the common name of Arnica Montana?',
        options: { A: 'Leopard’s Bane', B: 'Monkshood', C: 'Club Moss', D: 'Deadly Nightshade' },
        correctOption: 'A'
      }
    ]
  };

  const user = {
    id: 'usr_1001',
    name: 'Dr. John Doe',
    email: 'john.doe@whitecoat.academy',
    role: 'student'
  };

  console.log('Generating PDF for 2-question exam...');
  const buffer1 = await generateWatermarkedAnswerKeyPDF(smallExam, user);
  
  // Test 2: Medium Exam (Should be exactly 2 pages with NO trailing page 3)
  const mediumQuestions = [];
  for (let i = 1; i <= 18; i++) {
    mediumQuestions.push({
      _id: `q_${i}`,
      questionText: `Question #${i}: This is a medium-length question text describing a clinical scenario in homeopathy for item #${i}?`,
      options: {
        A: `Option A for Q${i}`,
        B: `Option B (Correct Answer) for Q${i}`,
        C: `Option C for Q${i}`,
        D: `Option D for Q${i}`
      },
      correctOption: 'B',
      explanation: `Explanation for Q${i}: Keynote indications point directly to Option B.`
    });
  }

  const mediumExam = {
    ...smallExam,
    title: 'Grand Mock Test - 18 Clinical Questions',
    totalQuestions: 18,
    questions: mediumQuestions
  };

  console.log('Generating PDF for 18-question exam...');
  const buffer2 = await generateWatermarkedAnswerKeyPDF(mediumExam, user);

  fs.writeFileSync(path.join(__dirname, 'output_small.pdf'), buffer1);
  fs.writeFileSync(path.join(__dirname, 'output_medium.pdf'), buffer2);

  console.log('Saved output_small.pdf and output_medium.pdf');
}

testFullPdfSync().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});
