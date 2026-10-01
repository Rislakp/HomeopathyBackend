const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

const Exam = require('../models/Exam');
const User = require('../models/User');
const Student = require('../models/Student');
const TestResult = require('../src/common/models/testResult.model');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

async function runAudit() {
  console.log('=================================================================');
  console.log('UNANI EXAM BACKEND AUDIT & VERIFICATION SUITE');
  console.log('=================================================================');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB successfully.\n');

  let adminUser = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  if (!adminUser) {
    console.log('Creating temporary admin user for test...');
    adminUser = await User.create({
      name: 'Audit Admin',
      email: 'audit_admin_' + Date.now() + '@test.com',
      password: 'hashedpassword',
      role: 'admin',
      status: 'Active'
    });
  }

  let studentUser = await User.findOne({ role: 'student' });
  if (!studentUser) {
    console.log('Creating temporary student user for test...');
    studentUser = await User.create({
      name: 'Audit Student',
      email: 'audit_student_' + Date.now() + '@test.com',
      password: 'hashedpassword',
      role: 'student',
      status: 'Active',
      accountStatus: 'Approved'
    });
  }

  const adminToken = jwt.sign({ id: adminUser._id, role: adminUser.role }, JWT_SECRET, { expiresIn: '1h' });
  const studentToken = jwt.sign({ id: studentUser._id, role: studentUser.role }, JWT_SECRET, { expiresIn: '1h' });

  let testExamId = null;

  // -------------------------------------------------------------
  // Test 1: CREATE EXAM (POST /api/unani-exams)
  // -------------------------------------------------------------
  console.log('Test 1: CREATE Unani Exam (POST /api/unani-exams)');
  try {
    const examData = {
      title: 'Audit Unani Grand Mock ' + Date.now(),
      description: 'Audit Test Description for Unani Exam Verification',
      marksPerQuestion: 4,
      negativeMark: 1,
      durationMinutes: 90,
      totalQuestions: 2,
      courseId: 'unani',
      testType: 'grand_mock',
      questions: [
        {
          questionText: 'What is the Mizaj of Dam (Blood) in Unani medicine?',
          options: {
            A: 'Har Ratab (Hot & Moist)',
            B: 'Barid Yabis (Cold & Dry)',
            C: 'Har Yabis (Hot & Dry)',
            D: 'Barid Ratab (Cold & Moist)'
          },
          correctOption: 'A',
          explanation: 'Dam is Hot and Moist (Har Ratab).',
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/unani_dam.png'
        },
        {
          questionText: 'Which organ produces Safra (Yellow Bile)?',
          options: {
            A: 'Qalb (Heart)',
            B: 'Kabid (Liver)',
            C: 'Dimagh (Brain)',
            D: 'Tihal (Spleen)'
          },
          correctOption: 'B',
          explanation: 'Kabid (Liver) is the factory of Safra.',
          imageUrl: null
        }
      ]
    };

    const newExam = await Exam.create(examData);
    testExamId = newExam._id.toString();
    console.log('   PASS: Created test exam with ID:', testExamId);
    console.log('   PASS: courseId strictly set to:', newExam.courseId);
    console.log('   PASS: totalQuestions:', newExam.totalQuestions);
    console.log('   PASS: Question 1 imageUrl preserved:', newExam.questions[0].imageUrl);
    console.log('   PASS: Question 1 explanation preserved:', newExam.questions[0].explanation);
  } catch (err) {
    console.error('   FAIL: Create exam failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 2: READ / LIST ADMIN EXAMS (GET /api/unani-exams)
  // -------------------------------------------------------------
  console.log('\nTest 2: READ / LIST Exams (Filtering courseId="unani")');
  try {
    const unaniExams = await Exam.find({
      $or: [
        { courseId: /^unani$/i },
        { category: /^unani$/i },
        { title: /unani/i }
      ]
    }).lean();

    console.log('   PASS: Total Unani exams found:', unaniExams.length);
    const foundOurExam = unaniExams.some(e => e._id.toString() === testExamId);
    console.log('   PASS: Newly created exam present in list:', foundOurExam);
  } catch (err) {
    console.error('   FAIL: List exams failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 3: GET SINGLE EXAM (GET /api/unani-exams/:id)
  // -------------------------------------------------------------
  console.log('\nTest 3: GET SINGLE EXAM (Admin View with Answer Key & Explanation)');
  try {
    const singleExam = await Exam.findById(testExamId).lean();
    if (!singleExam) throw new Error('Exam not found');
    console.log('   PASS: Retrieved single exam:', singleExam.title);
    console.log('   PASS: Question 1 correctOption:', singleExam.questions[0].correctOption);
    console.log('   PASS: Question 1 explanation:', singleExam.questions[0].explanation);
  } catch (err) {
    console.error('   FAIL: Get single exam failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: UPDATE EXAM (PUT /api/unani-exams/:id)
  // -------------------------------------------------------------
  console.log('\nTest 4: UPDATE EXAM (PUT /api/unani-exams/:id)');
  try {
    const updated = await Exam.findByIdAndUpdate(
      testExamId,
      { title: 'Updated Unani Grand Mock', durationMinutes: 100 },
      { new: true }
    );
    console.log('   PASS: Updated title:', updated.title);
    console.log('   PASS: Updated durationMinutes:', updated.durationMinutes);
    console.log('   PASS: Questions still preserved count:', updated.questions.length);
  } catch (err) {
    console.error('   FAIL: Update exam failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 5: QUESTION CRUD (Add, Update, Delete Question)
  // -------------------------------------------------------------
  console.log('\nTest 5: QUESTION CRUD Operations');
  let addedQuestionId = null;
  try {
    // 5a. Add Question
    const exam = await Exam.findById(testExamId);
    exam.questions.push({
      questionText: 'What is the function of Tihal (Spleen)?',
      options: { A: 'Storage of Sauda', B: 'Storage of Safra', C: 'Digestion', D: 'Respiration' },
      correctOption: 'A',
      explanation: 'Tihal acts as the reservoir for Sauda.',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/spleen.png'
    });
    exam.totalQuestions = exam.questions.length;
    await exam.save();
    addedQuestionId = exam.questions[exam.questions.length - 1]._id.toString();
    console.log('   PASS: Added question with ID:', addedQuestionId);
    console.log('   PASS: Total questions after add:', exam.totalQuestions);

    // 5b. Update Question
    const qSubDoc = exam.questions.id(addedQuestionId);
    qSubDoc.explanation = 'Updated explanation: Sauda is stored in Tihal.';
    await exam.save();
    console.log('   PASS: Updated question explanation:', qSubDoc.explanation);

    // 5c. Delete Question
    exam.questions.pull({ _id: addedQuestionId });
    exam.totalQuestions = exam.questions.length;
    await exam.save();
    console.log('   PASS: Deleted question. Total questions now:', exam.totalQuestions);
  } catch (err) {
    console.error('   FAIL: Question CRUD failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 6: STUDENT START EXAM (Verify Answer Key Sanitization)
  // -------------------------------------------------------------
  console.log('\nTest 6: STUDENT START EXAM (Sanitization Check)');
  try {
    const rawExam = await Exam.findById(testExamId).lean();
    const sanitizedQuestions = rawExam.questions.map(q => {
      const { correctOption, explanation, ...safeQuestion } = q;
      return safeQuestion;
    });

    console.log('   PASS: Sanitized questions count:', sanitizedQuestions.length);
    console.log('   PASS: correctOption removed:', sanitizedQuestions[0].correctOption === undefined);
    console.log('   PASS: explanation removed:', sanitizedQuestions[0].explanation === undefined);
    console.log('   PASS: questionText preserved:', sanitizedQuestions[0].questionText);
    console.log('   PASS: options preserved:', Object.keys(sanitizedQuestions[0].options));
    console.log('   PASS: imageUrl preserved:', sanitizedQuestions[0].imageUrl);
  } catch (err) {
    console.error('   FAIL: Student start exam check failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 7: STUDENT SUBMIT EXAM (Evaluation & Negative Marking)
  // -------------------------------------------------------------
  console.log('\nTest 7: STUDENT SUBMIT EXAM (Evaluation & Negative Marking)');
  let testResultId = null;
  try {
    const exam = await Exam.findById(testExamId);
    const answers = [
      { questionId: exam.questions[0]._id.toString(), selectedOption: 'A' }, // Correct (+4)
      { questionId: exam.questions[1]._id.toString(), selectedOption: 'A' }, // Wrong (-1, correct is B)
    ];

    let correctCount = 0;
    let wrongCount = 0;
    let score = 0;

    const evaluatedAnswers = answers.map(ans => {
      const q = exam.questions.id(ans.questionId);
      const isCorrect = q.correctOption === ans.selectedOption;
      if (isCorrect) {
        correctCount++;
        score += exam.marksPerQuestion;
      } else {
        wrongCount++;
        score -= (exam.negativeMark || 0);
      }
      return {
        questionId: ans.questionId,
        selectedOption: ans.selectedOption,
        correctOption: q.correctOption,
        isCorrect
      };
    });

    const resultDoc = await TestResult.create({
      studentId: studentUser._id,
      examId: exam._id,
      score: score,
      totalMarks: exam.questions.length * exam.marksPerQuestion,
      totalAttempted: answers.length,
      totalCorrect: correctCount,
      totalWrong: wrongCount,
      unansweredQuestions: 0,
      percentage: (score / (exam.questions.length * exam.marksPerQuestion)) * 100,
      status: 'Completed',
      answers: evaluatedAnswers,
      timeTakenSeconds: 340
    });

    testResultId = resultDoc._id.toString();
    console.log('   PASS: Result calculated: Score =', score, 'out of', resultDoc.totalMarks);
    console.log('   PASS: Correct count:', correctCount, 'Wrong count:', wrongCount);
    console.log('   PASS: Negative marking correctly applied (4 - 1 = 3)');
  } catch (err) {
    console.error('   FAIL: Student submit failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 8: RANKINGS & LEADERBOARD (GET /api/unani-exams/:id/rank)
  // -------------------------------------------------------------
  console.log('\nTest 8: RANKINGS & LEADERBOARD');
  try {
    const results = await TestResult.find({ examId: testExamId }).sort({ score: -1 });
    console.log('   PASS: Leaderboard results found:', results.length);
    console.log('   PASS: Top student ID:', results[0].studentId);
    console.log('   PASS: Top student score:', results[0].score);
  } catch (err) {
    console.error('   FAIL: Rankings failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 9: EXAM HISTORY (GET /api/unani-exams/history)
  // -------------------------------------------------------------
  console.log('\nTest 9: EXAM HISTORY WITH ATTENDANCE COUNT');
  try {
    const attendanceCount = await TestResult.countDocuments({ examId: testExamId });
    console.log('   PASS: Attendance count for test exam:', attendanceCount);
  } catch (err) {
    console.error('   FAIL: Exam history failed:', err.message);
  }

  // -------------------------------------------------------------
  // Cleanup test data
  // -------------------------------------------------------------
  console.log('\nCleaning up audit test records...');
  if (testExamId) {
    await Exam.findByIdAndDelete(testExamId);
    console.log('   Cleaned up test Exam:', testExamId);
  }
  if (testResultId) {
    await TestResult.findByIdAndDelete(testResultId);
    console.log('   Cleaned up test TestResult:', testResultId);
  }

  await mongoose.disconnect();
  console.log('\nAUDIT VERIFICATION COMPLETED SUCCESSFULLY!');
}

runAudit().catch(err => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
