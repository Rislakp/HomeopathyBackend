const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const testResultsColl = db.collection('testresults');

  const doc = await testResultsColl.findOne({ _id: new mongoose.Types.ObjectId('6ae85ddeb76cb62502bb0e9d') });
  console.log('Result 6ae85ddeb76cb62502bb0e9d:');
  console.log(JSON.stringify(doc, null, 2));

  // Also check all results for this student
  const allForStudent = await testResultsColl.find({ studentId: doc.studentId }).toArray();
  console.log(`All results for student ${doc.studentId}: ${allForStudent.length}`);
  for (const r of allForStudent) {
    console.log({
      _id: r._id,
      examId: r.examId,
      score: r.score,
      totalCorrect: r.totalCorrect,
      totalWrong: r.totalWrong,
      unanswered: r.unansweredQuestions,
      attemptNumber: r.attemptNumber,
      createdAt: r.createdAt,
    });
  }

  process.exit(0);
}

run();

