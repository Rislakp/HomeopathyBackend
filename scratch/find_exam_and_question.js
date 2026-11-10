const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  console.log('Collections in DB:', collections.map(c => c.name));

  // Search each collection for "CONSTANTLY THEORISING" or "cannabis"
  for (const collInfo of collections) {
    const collName = collInfo.name;
    try {
      const coll = db.collection(collName);
      const docs = await coll.find({
        $or: [
          { question: { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
          { questionText: { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
          { 'questions.question': { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
          { 'questions.questionText': { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
          { 'answers.questionText': { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
          { 'userAnswers.questionText': { $regex: 'CONSTANTLY THEORISING', $options: 'i' } },
        ]
      }).limit(5).toArray();

      if (docs.length > 0) {
        console.log(`\n=== Found ${docs.length} match(es) in collection: ${collName} ===`);
        for (const doc of docs) {
          console.log(`Document _id: ${doc._id}`);
          if (doc.title || doc.examTitle || doc.name) {
            console.log(`Title: ${doc.title || doc.examTitle || doc.name}`);
          }
          if (doc.examId) console.log(`examId: ${doc.examId}`);
          if (doc.courseId) console.log(`courseId: ${doc.courseId}`);
          if (doc.studentId) console.log(`studentId: ${doc.studentId}`);

          // If questions array exists
          if (Array.isArray(doc.questions)) {
            const matchedQ = doc.questions.filter(q =>
              JSON.stringify(q).toLowerCase().includes('constantly theorising') ||
              JSON.stringify(q).toLowerCase().includes('cannabis')
            );
            console.log(`Matched questions in doc:`, JSON.stringify(matchedQ, null, 2));
          } else {
            console.log('Doc preview:', JSON.stringify(doc, null, 2).slice(0, 1500));
          }
        }
      }
    } catch (e) {
      // ignore collection query errors (e.g. system views)
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

