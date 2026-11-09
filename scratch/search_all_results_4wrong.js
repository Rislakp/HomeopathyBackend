const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const coll = db.collection(collName);
    try {
      const docs = await coll.find({
        $or: [
          { totalWrong: 4 },
          { wrong: 4 },
          { totalCorrect: 0, totalWrong: { $gt: 0 } },
          { unansweredQuestions: 46 },
          { unanswered: 46 },
        ]
      }).toArray();

      if (docs.length > 0) {
        console.log(`\n=== Found ${docs.length} in ${collName} ===`);
        for (const d of docs) {
          console.log({
            _id: d._id,
            examId: d.examId,
            studentId: d.studentId || d.userId,
            score: d.score,
            totalCorrect: d.totalCorrect || d.correct,
            totalWrong: d.totalWrong || d.wrong,
            unanswered: d.unansweredQuestions || d.unanswered,
            answersCount: (d.answers || d.userAnswers || []).length,
          });
        }
      }
    } catch (e) {}
  }

  process.exit(0);
}

run();

