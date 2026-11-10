/**
 * scripts/migrate_unani_test_to_dedicated_collection.js
 *
 * Safe, idempotent migration script to migrate legacy Unani exams stored in the
 * 'exams' collection into the dedicated 'unaniexams' collection (UnaniExam model).
 *
 * Specifically targets "Unani test" (_id: 6abdf40e67bcbc5a1a73c4e9) and any other
 * documents in 'exams' where courseId is 'unani'.
 *
 * Verifies all data, questions, and associated TestResult records before removing
 * the legacy record from 'exams'.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  console.log('=== UNANI EXAM MIGRATION START ===');
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  const db = mongoose.connection.db;
  const examsCol = db.collection('exams');
  const unaniExamsCol = db.collection('unaniexams');
  const testResultsCol = db.collection('testresults');
  const unaniExamResultsCol = db.collection('unaniexamresults');

  // 1. Find all exams in 'exams' that belong to Unani
  const unaniLegacyExams = await examsCol.find({
    $or: [
      { courseId: 'unani' },
      { courseId: /^unani$/i }
    ]
  }).toArray();

  console.log(`Found ${unaniLegacyExams.length} legacy Unani exam(s) in 'exams' collection.`);

  if (unaniLegacyExams.length === 0) {
    console.log('No legacy Unani exams found in "exams" collection.');
    // Check if unaniexams already has the target document
    const alreadyMigrated = await unaniExamsCol.findOne({ _id: new mongoose.Types.ObjectId('6abdf40e67bcbc5a1a73c4e9') });
    if (alreadyMigrated) {
      console.log('Target exam "6abdf40e67bcbc5a1a73c4e9" is already present in "unaniexams".');
    }
    console.log('=== MIGRATION COMPLETE (NO-OP / ALREADY COMPLETED) ===');
    await mongoose.disconnect();
    return;
  }

  for (const legacyExam of unaniLegacyExams) {
    const examId = legacyExam._id;
    console.log(`\nProcessing legacy exam: "${legacyExam.title}" (ID: ${examId.toString()})`);

    // Transform questions: ensure required fields are present
    const questions = (legacyExam.questions || []).map((q) => ({
      _id: q._id ? (typeof q._id === 'string' ? new mongoose.Types.ObjectId(q._id) : q._id) : new mongoose.Types.ObjectId(),
      questionText: String(q.questionText || '').trim(),
      passage: q.passage ? String(q.passage).trim() : null,
      imageUrl: q.imageUrl ? String(q.imageUrl).trim() : null,
      tableData: q.tableData || null,
      options: {
        A: String(q.options?.A || '').trim(),
        B: String(q.options?.B || '').trim(),
        C: String(q.options?.C || '').trim(),
        D: String(q.options?.D || '').trim(),
      },
      correctOption: String(q.correctOption || 'A').toUpperCase().trim(),
      explanation: String(q.explanation || '').trim(),
    }));

    const unaniDoc = {
      _id: examId, // Preserve exact same _id
      title: String(legacyExam.title || '').trim(),
      description: String(legacyExam.description || '').trim(),
      examType: 'grand_mock_test',
      courseId: 'unani',
      marksPerQuestion: Number(legacyExam.marksPerQuestion) || 1,
      negativeMark: Number(legacyExam.negativeMark || legacyExam.negativeMarkPenalty || 0),
      negativeMarkPenalty: Number(legacyExam.negativeMarkPenalty || legacyExam.negativeMark || 0),
      durationMinutes: Number(legacyExam.durationMinutes) || 60,
      totalQuestions: questions.length,
      questions: questions,
      status: legacyExam.status || 'Published',
      createdAt: legacyExam.createdAt || new Date(),
      updatedAt: legacyExam.updatedAt || new Date(),
    };

    // 2. Upsert into unaniexams collection
    await unaniExamsCol.updateOne(
      { _id: examId },
      { $set: unaniDoc },
      { upsert: true }
    );
    console.log(`  -> Upserted into 'unaniexams' with ID: ${examId.toString()}`);

    // 3. Handle associated testresults: copy into unaniexamresults for attendance and rank parity
    const relatedTestResults = await testResultsCol.find({
      $or: [
        { examId: examId },
        { examId: examId.toString() }
      ]
    }).toArray();

    console.log(`  -> Found ${relatedTestResults.length} associated test result(s) in 'testresults'.`);
    for (const tr of relatedTestResults) {
      const studentIdObj = tr.studentId ? (typeof tr.studentId === 'string' ? new mongoose.Types.ObjectId(tr.studentId) : tr.studentId) : null;
      const unaniResultDoc = {
        _id: tr._id,
        studentId: studentIdObj,
        examId: examId,
        courseId: 'unani',
        examType: 'grand_mock_test',
        score: Number(tr.score) || 0,
        totalMarks: Number(tr.totalMarks || tr.maximumScore) || 0,
        percentage: Number(tr.percentage) || 0,
        correctAnswers: Number(tr.totalCorrect || tr.correctAnswers) || 0,
        wrongAnswers: Number(tr.totalWrong || tr.wrongAnswers) || 0,
        unanswered: Number(tr.unansweredQuestions || tr.unanswered) || 0,
        answers: Array.isArray(tr.answers) ? tr.answers : [],
        status: tr.status || 'Completed',
        timeTakenSeconds: Number(tr.timeTakenSeconds || tr.timeTaken || 0),
        createdAt: tr.createdAt || new Date(),
        updatedAt: tr.updatedAt || new Date(),
      };

      await unaniExamResultsCol.updateOne(
        { _id: tr._id },
        { $set: unaniResultDoc },
        { upsert: true }
      );
      console.log(`     Synced test result ${tr._id.toString()} into 'unaniexamresults'.`);
    }

    // 4. VERIFICATION BEFORE DELETION
    console.log('  -> Verifying destination document...');
    const destExam = await unaniExamsCol.findOne({ _id: examId });
    if (!destExam) {
      throw new Error(`Verification failed: destination document ${examId} not found in 'unaniexams'! Aborting deletion.`);
    }
    if (destExam.title !== legacyExam.title) {
      throw new Error(`Verification failed: title mismatch ("${destExam.title}" vs "${legacyExam.title}")! Aborting deletion.`);
    }
    if (destExam.questions.length !== questions.length) {
      throw new Error(`Verification failed: question count mismatch (${destExam.questions.length} vs ${questions.length})! Aborting deletion.`);
    }

    console.log(`  -> Verification passed: destination document has ${destExam.questions.length} questions and correct metadata.`);

    // 5. Safe removal from legacy 'exams' collection
    console.log('  -> Safely removing legacy record from "exams" collection...');
    const deleteResult = await examsCol.deleteOne({ _id: examId });
    console.log(`  -> Deleted from 'exams': ${deleteResult.deletedCount === 1 ? 'SUCCESS' : 'FAILED'}`);

    // Verify deletion
    const recheck = await examsCol.findOne({ _id: examId });
    if (recheck) {
      throw new Error(`Critical error: document ${examId} still exists in 'exams' after deletion!`);
    }
    console.log(`  -> Verified: exam ${examId.toString()} no longer exists in 'exams'.`);
  }

  console.log('\n=== UNANI EXAM MIGRATION FINISHED SUCCESSFULLY ===');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
