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
      { totalCorrect: 0, totalWrong: 4, unansweredQuestions: 46 },
      { 'answers.questionText': 'CONSTANTLY THEORISING', totalCorrect: 0 },
      { examId: new mongoose.Types.ObjectId('6ad9ce991d1d06b448da8eec'), totalCorrect: 0 },
      { examId: '6ad9ce991d1d06b448da8eec', totalCorrect: 0 },
      { totalWrong: 4, unansweredQuestions: 46 },
    ]
  }).toArray();

  console.log(`Found ${results.length} matching testresults:`);
  for (const r of results) {
    console.log('\n----------------------------------------');
    console.log(`Result _id: ${r._id}`);
    console.log(`studentId: ${r.studentId}`);
    console.log(`examId: ${r.examId}`);
    console.log(`score: ${r.score}, totalCorrect: ${r.totalCorrect}, totalWrong: ${r.totalWrong}, unanswered: ${r.unansweredQuestions}`);
    console.log(`status: ${r.status}, createdAt: ${r.createdAt}`);
    console.log('Attempted answers count:', (r.answers || []).length);

    // Find the CONSTANTLY THEORISING answer
    const qAns = (r.answers || []).find(a =>
      (a.questionText && a.questionText.includes('CONSTANTLY THEORISING')) ||
      (a.questionId && a.questionId.toString() === '6adefb432cea39ee852c012c')
    );
    if (qAns) {
      console.log('CONSTANTLY THEORISING answer in this result:');
      console.log(JSON.stringify(qAns, null, 2));
    }
  }

  process.exit(0);
}

run();

