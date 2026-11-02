const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const db = mongoose.connection.db;
  const testResultsColl = db.collection('testresults');

  const results = await testResultsColl.find({
    $or: [
      { totalWrong: 4, unansweredQuestions: 46 },
      { totalCorrect: 0, totalWrong: 4 },
      { totalAttempted: 4, totalCorrect: 0 },
    ]
  }).toArray();

  console.log(`Found ${results.length} matching testresults:`);
  for (const r of results) {
    console.log('\n----------------------------------------');
    console.log(`Result _id: ${r._id}`);
    console.log(`studentId: ${r.studentId}`);
    console.log(`examId: ${r.examId}`);
    console.log(`score: ${r.score}, totalMarks: ${r.totalMarks}, totalCorrect: ${r.totalCorrect}, totalWrong: ${r.totalWrong}, unanswered: ${r.unansweredQuestions}`);
    console.log(`status: ${r.status}, createdAt: ${r.createdAt}`);

    // Show attempted answers in this result
    const attempted = (r.answers || []).filter(a => a.selectedOption || a.selectedAnswer);
    console.log(`Attempted answers count: ${attempted.length}`);
    for (const a of attempted) {
      console.log('Answer item:', {
        questionId: a.questionId,
        questionText: a.questionText,
        selectedOption: a.selectedOption,
        selectedAnswer: a.selectedAnswer,
        selectedOptionText: a.selectedOptionText,
        correctOption: a.correctOption,
        correctAnswer: a.correctAnswer,
        correctOptionText: a.correctOptionText,
        status: a.status,
        isCorrect: a.isCorrect,
      });
    }
  }

  process.exit(0);
}

run();

