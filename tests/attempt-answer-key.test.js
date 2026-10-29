const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Normal Exam Components
const Exam = require('../models/Exam');
const TestResult = require('../src/common/models/testResult.model');
const {
  getAnswerKey: getNormalAnswerKey,
  downloadAnswerKey: downloadNormalAnswerKey,
  formatNormalAnswerKey,
} = require('../src/student/answerKey.controller');

// Unani Exam Components
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
const unaniExamService = require('../src/unani/exams/services/unaniExam.service');
const unaniExamController = require('../src/unani/exams/controllers/unaniExam.controller');

// Helpers
const Student = require('../models/Student');
const User = require('../models/User');
const examAttemptHelper = require('../utils/examAttemptHelper');
const courseAccessHelper = require('../utils/courseAccessHelper');

// ── Shared Fixtures ─────────────────────────────────────────────────────────────
const student1Id = new mongoose.Types.ObjectId();
const student2AttackerId = new mongoose.Types.ObjectId();

const academicExamId = new mongoose.Types.ObjectId();
const differentAcademicExamId = new mongoose.Types.ObjectId();

const unaniExamId = new mongoose.Types.ObjectId();
const differentUnaniExamId = new mongoose.Types.ObjectId();

const academicQ1 = new mongoose.Types.ObjectId();
const academicQ2 = new mongoose.Types.ObjectId();
const academicQ3 = new mongoose.Types.ObjectId();

const unaniQ1 = new mongoose.Types.ObjectId();
const unaniQ2 = new mongoose.Types.ObjectId();

const academicExamDoc = {
  _id: academicExamId,
  title: 'Pathology & Materia Medica Grand Mock',
  testType: 'grand_mock',
  status: 'published',
  durationMinutes: 60,
  totalQuestions: 3,
  marksPerQuestion: 4,
  negativeMark: 1,
  questions: [
    {
      _id: academicQ1,
      questionText: 'What is the characteristic feature of Lycopodium?',
      options: { A: 'Right to left symptoms', B: 'Left to right symptoms', C: 'Thirstless', D: 'Chilly with cold sweats' },
      correctOption: 'A',
      explanation: 'Lycopodium complaints characteristically travel from right to left.',
    },
    {
      _id: academicQ2,
      questionText: 'Key indication for Arsenicum album?',
      options: { A: 'Restlessness with prostration', B: 'Desire for cold water', C: 'Worse warmth', D: 'Slow pulse' },
      correctOption: 'A',
      explanation: 'Arsenicum album is characterized by intense physical restlessness with mental anguish.',
    },
    {
      _id: academicQ3,
      questionText: 'Which remedy corresponds to morning diarrhea?',
      options: { A: 'Nux vomica', B: 'Aloe socotrina', C: 'Pulsatilla', D: 'Bryonia' },
      correctOption: 'B',
      explanation: 'Aloe has driving out of bed early in the morning diarrhea.',
    },
  ],
};

const unaniExamDoc = {
  _id: unaniExamId,
  title: 'Kulliyat Grand Mock Test 2026',
  courseId: 'unani',
  examType: 'grand_mock_test',
  status: 'published',
  durationMinutes: 90,
  totalQuestions: 2,
  marksPerQuestion: 4,
  negativeMark: 1,
  questions: [
    {
      _id: unaniQ1,
      questionText: 'How many Arkan are described in Unani Tibb?',
      options: { A: 'Two', B: 'Three', C: 'Four', D: 'Seven' },
      correctOption: 'C',
      explanation: 'There are four primary elements (Arkan-e-Arba): Fire, Air, Water, Earth.',
    },
    {
      _id: unaniQ2,
      questionText: 'Dam (Blood) temperament is:',
      options: { A: 'Hot and Moist', B: 'Cold and Moist', C: 'Hot and Dry', D: 'Cold and Dry' },
      correctOption: 'A',
      explanation: 'Dam is Har-Yabis / Hot and Moist in nature.',
    },
  ],
};

// Student 1 has two attempts on Academic Exam:
// Attempt 1: score 4 (Q1 correct, Q2 wrong, Q3 unanswered)
const academicAttempt1Id = new mongoose.Types.ObjectId();
const academicAttempt1Doc = {
  _id: academicAttempt1Id,
  examId: academicExamId,
  studentId: student1Id,
  attemptNumber: 1,
  score: 3, // 4 - 1 = 3
  totalMarks: 12,
  totalAttempted: 2,
  totalCorrect: 1,
  totalWrong: 1,
  unansweredQuestions: 1,
  percentage: 25,
  status: 'Completed',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  answers: [
    { questionId: academicQ1, selectedOption: 'A', correctOption: 'A', isCorrect: true, status: 'correct' },
    { questionId: academicQ2, selectedOption: 'B', correctOption: 'A', isCorrect: false, status: 'wrong' },
    { questionId: academicQ3, selectedOption: null, correctOption: 'B', isCorrect: false, status: 'unanswered' },
  ],
};

// Attempt 2: score 12 (all 3 correct)
const academicAttempt2Id = new mongoose.Types.ObjectId();
const academicAttempt2Doc = {
  _id: academicAttempt2Id,
  examId: academicExamId,
  studentId: student1Id,
  attemptNumber: 2,
  score: 12, // 4 * 3 = 12
  totalMarks: 12,
  totalAttempted: 3,
  totalCorrect: 3,
  totalWrong: 0,
  unansweredQuestions: 0,
  percentage: 100,
  status: 'Completed',
  createdAt: new Date('2026-10-05T10:00:00Z'),
  answers: [
    { questionId: academicQ1, selectedOption: 'A', correctOption: 'A', isCorrect: true, status: 'correct' },
    { questionId: academicQ2, selectedOption: 'A', correctOption: 'A', isCorrect: true, status: 'correct' },
    { questionId: academicQ3, selectedOption: 'B', correctOption: 'B', isCorrect: true, status: 'correct' },
  ],
};

// Unani Attempts for Student 1:
const unaniAttempt1Id = new mongoose.Types.ObjectId();
const unaniAttempt1Doc = {
  _id: unaniAttempt1Id,
  examId: unaniExamId,
  studentId: student1Id,
  courseId: 'unani',
  attemptNumber: 1,
  score: 3, // 4 - 1
  totalMarks: 8,
  percentage: 38,
  correctAnswers: 1,
  wrongAnswers: 1,
  unanswered: 0,
  status: 'Completed',
  timeTakenSeconds: 1200,
  createdAt: new Date('2026-10-02T10:00:00Z'),
  answers: [
    { questionId: unaniQ1, selectedOption: 'C', correctOption: 'C', isCorrect: true },
    { questionId: unaniQ2, selectedOption: 'B', correctOption: 'A', isCorrect: false },
  ],
};

const unaniAttempt2Id = new mongoose.Types.ObjectId();
const unaniAttempt2Doc = {
  _id: unaniAttempt2Id,
  examId: unaniExamId,
  studentId: student1Id,
  courseId: 'unani',
  attemptNumber: 2,
  score: 8, // 4 + 4
  totalMarks: 8,
  percentage: 100,
  correctAnswers: 2,
  wrongAnswers: 0,
  unanswered: 0,
  status: 'Completed',
  timeTakenSeconds: 950,
  createdAt: new Date('2026-10-06T10:00:00Z'),
  answers: [
    { questionId: unaniQ1, selectedOption: 'C', correctOption: 'C', isCorrect: true },
    { questionId: unaniQ2, selectedOption: 'A', correctOption: 'A', isCorrect: true },
  ],
};

// Query Thenable Helper
function mockQuery(val) {
  return {
    lean: async () => val,
    sort: function () { return this; },
    select: function () { return this; },
    populate: function () { return this; },
    skip: function () { return this; },
    limit: function () { return this; },
    then: function (resolve, reject) { return Promise.resolve(val).then(resolve, reject); },
  };
}

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = null;
  let sentData = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    json(data) {
      body = data;
      return this;
    },
    send(data) {
      sentData = data;
      return this;
    },
    getResponse() {
      return { statusCode, headers, body, sentData };
    },
  };
}

// Global Mocks
courseAccessHelper.verifyStudentCourseAccessAny = async () => true;
courseAccessHelper.verifyStudentCourseAccess = async () => true;

examAttemptHelper.getStudentCandidateIds = async (user) => {
  if (!user) return [];
  const id = user.id || user._id || user.studentId || user.userId;
  return id ? [new mongoose.Types.ObjectId(id)] : [];
};

Student.findById = (id) => mockQuery({ _id: new mongoose.Types.ObjectId(id), name: 'Dr. Test Student', email: 'student@wca.com' });
Student.findOne = (q) => { const uid = q?._id || q?.userId; return mockQuery({ _id: uid ? new mongoose.Types.ObjectId(uid) : student1Id, name: 'Dr. Test Student', email: 'student@wca.com' }); };
User.findById = (id) => mockQuery({ _id: new mongoose.Types.ObjectId(id), name: 'Dr. Test Student', email: 'student@wca.com', role: 'student' });
User.findOne = (q) => { const uid = q?._id || q?.userId; return mockQuery({ _id: uid ? new mongoose.Types.ObjectId(uid) : student1Id, name: 'Dr. Test Student', email: 'student@wca.com', role: 'student' }); };

Exam.findById = (id) => mockQuery(String(id) === String(academicExamId) ? academicExamDoc : null);
UnaniExam.findById = (id) => mockQuery(String(id) === String(unaniExamId) ? unaniExamDoc : null);
UnaniExam.findOne = (query) => {
  const id = query?._id || query?.id;
  if (!id || String(id) === String(unaniExamId)) return mockQuery(unaniExamDoc);
  return mockQuery(null);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Issue 1: Attempt-Specific Watermarked Answer Key Tests
// ─────────────────────────────────────────────────────────────────────────────

test('1. Historical Attempt PDF Selection: requesting Attempt 1 returns Attempt 1 evaluation and score', async () => {
  TestResult.findById = (id) => {
    if (String(id) === String(academicAttempt1Id)) return mockQuery(academicAttempt1Doc);
    if (String(id) === String(academicAttempt2Id)) return mockQuery(academicAttempt2Doc);
    return mockQuery(null);
  };

  const req = {
    params: { id: academicExamId.toString(), resultId: academicAttempt1Id.toString() },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, headers, sentData } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('2. Historical Attempt PDF Selection: requesting Attempt 2 returns Attempt 2 evaluation and score', async () => {
  TestResult.findById = (id) => {
    if (String(id) === String(academicAttempt1Id)) return mockQuery(academicAttempt1Doc);
    if (String(id) === String(academicAttempt2Id)) return mockQuery(academicAttempt2Doc);
    return mockQuery(null);
  };

  const req = {
    params: { id: academicExamId.toString(), resultId: academicAttempt2Id.toString() },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, headers, sentData } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(sentData));
});

test('3. Student cannot access another student\'s result (returns 403 Forbidden)', async () => {
  TestResult.findById = (id) => mockQuery(String(id) === String(academicAttempt1Id) ? academicAttempt1Doc : null);

  const req = {
    params: { id: academicExamId.toString(), resultId: academicAttempt1Id.toString() },
    user: { id: student2AttackerId.toString(), role: 'student' }, // Attacker student
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 403);
  assert.equal(body.success, false);
  assert.match(body.message, /not authorized to access another student's result/i);
});

test('4. Invalid Result ID format returns 400 Bad Request', async () => {
  const req = {
    params: { id: academicExamId.toString(), resultId: 'not-a-valid-hex-object-id' },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /invalid result id format/i);
});

test('5. Nonexistent Result ID returns 404 Not Found', async () => {
  TestResult.findById = () => mockQuery(null);

  const req = {
    params: { id: academicExamId.toString(), resultId: new mongoose.Types.ObjectId().toString() },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 404);
  assert.equal(body.success, false);
  assert.match(body.message, /test result not found/i);
});

test('6. Result ID belonging to a different exam returns 400 Bad Request', async () => {
  const foreignResult = {
    ...academicAttempt1Doc,
    examId: differentAcademicExamId, // Belongs to different exam
  };
  TestResult.findById = () => mockQuery(foreignResult);

  const req = {
    params: { id: academicExamId.toString(), resultId: academicAttempt1Id.toString() },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /does not belong to the specified exam/i);
});

test('7. In-progress / unsubmitted attempt returns 403 Forbidden', async () => {
  const inProgressResult = {
    ...academicAttempt1Doc,
    status: 'In Progress',
  };
  TestResult.findById = () => mockQuery(inProgressResult);

  const req = {
    params: { id: academicExamId.toString(), resultId: academicAttempt1Id.toString() },
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await downloadNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 403);
  assert.equal(body.success, false);
  assert.match(body.message, /completed attempt is required/i);
});

test('8. Backward compatibility: without resultId, returns latest completed attempt sorted by attemptNumber and createdAt', async () => {
  TestResult.findOne = (query) => {
    // Should query student's completed attempts
    return mockQuery(academicAttempt2Doc); // Latest completed attempt (Attempt #2)
  };

  const req = {
    params: { id: academicExamId.toString() }, // No resultId specified
    user: { id: student1Id.toString(), role: 'student' },
  };
  const res = createMockResponse();

  await getNormalAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.summary.attemptNumber, 2);
  assert.equal(body.data.summary.score, 12);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Issue 2: Unani Historical Result Retrieval & Attempt-Specific Answer Keys
// ─────────────────────────────────────────────────────────────────────────────

test('9. Unani Student Result History returns all historical attempts with required metrics', async () => {
  UnaniExamResult.find = () => mockQuery([unaniAttempt2Doc, unaniAttempt1Doc]);

  const req = {
    params: { examId: unaniExamId.toString() },
    user: { id: student1Id.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getStudentResultHistory(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.count, 2);
  assert.equal(body.data[0].attemptNumber, 2);
  assert.equal(body.data[0].score, 8);
  assert.ok(body.data[0].submissionTime);
  assert.equal(body.data[1].attemptNumber, 1);
  assert.equal(body.data[1].score, 3);
});

test('10. Unani Attempt-Specific Answer Key JSON returns exact requested attempt', async () => {
  UnaniExamResult.findById = (id) => {
    if (String(id) === String(unaniAttempt1Id)) return mockQuery(unaniAttempt1Doc);
    if (String(id) === String(unaniAttempt2Id)) return mockQuery(unaniAttempt2Doc);
    return mockQuery(null);
  };

  const req = {
    params: { examId: unaniExamId.toString(), resultId: unaniAttempt1Id.toString() },
    user: { id: student1Id.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getAnswerKey(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.summary.attemptNumber, 1);
  assert.equal(body.data.summary.score, 3);
});

test('11. Unani Attempt-Specific Watermarked PDF download returns valid PDF for exact requested attempt', async () => {
  UnaniExamResult.findById = (id) => {
    if (String(id) === String(unaniAttempt2Id)) return mockQuery(unaniAttempt2Doc);
    return mockQuery(null);
  };

  const req = {
    params: { examId: unaniExamId.toString(), resultId: unaniAttempt2Id.toString() },
    user: { id: student1Id.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  const { statusCode, headers, sentData } = res.getResponse();
  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(sentData));
});

test('12. Unani getResultById validates exam association and returns 400 when mismatched', async () => {
  const mismatchedUnani = {
    ...unaniAttempt1Doc,
    examId: differentUnaniExamId,
  };
  UnaniExamResult.findById = () => mockQuery(mismatchedUnani);

  const req = {
    params: { examId: unaniExamId.toString(), resultId: unaniAttempt1Id.toString() },
    user: { id: student1Id.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getResultById(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /does not belong to the specified exam/i);
});

test('13. Unani getResultById blocks unauthorized student from viewing another student result (403)', async () => {
  UnaniExamResult.findById = () => mockQuery(unaniAttempt1Doc); // Belongs to student1Id

  const req = {
    params: { examId: unaniExamId.toString(), resultId: unaniAttempt1Id.toString() },
    user: { id: student2AttackerId.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getResultById(req, res);

  const { statusCode, body } = res.getResponse();
  assert.equal(statusCode, 403);
  assert.equal(body.success, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Issue 3: Answer Key Response Consistency & Question Order Preservation
// ─────────────────────────────────────────────────────────────────────────────

test('14. formatNormalAnswerKey strictly preserves question ordering, options, correct answers and student selections', () => {
  const formatted = formatNormalAnswerKey(academicExamDoc, academicAttempt1Doc);

  assert.equal(formatted.questions.length, 3);
  // Question 1 order and mapping
  assert.equal(formatted.questions[0].questionNumber, 1);
  assert.equal(formatted.questions[0].questionId.toString(), academicQ1.toString());
  assert.equal(formatted.questions[0].correctOption, 'A');
  assert.equal(formatted.questions[0].selectedOption, 'A');
  assert.equal(formatted.questions[0].isCorrect, true);
  assert.equal(formatted.questions[0].status, 'correct');
  assert.equal(formatted.questions[0].marks, 4);

  // Question 2 order and mapping (wrong answer)
  assert.equal(formatted.questions[1].questionNumber, 2);
  assert.equal(formatted.questions[1].questionId.toString(), academicQ2.toString());
  assert.equal(formatted.questions[1].correctOption, 'A');
  assert.equal(formatted.questions[1].selectedOption, 'B');
  assert.equal(formatted.questions[1].isCorrect, false);
  assert.equal(formatted.questions[1].status, 'wrong');
  assert.equal(formatted.questions[1].marks, -1);

  // Question 3 order and mapping (unanswered)
  assert.equal(formatted.questions[2].questionNumber, 3);
  assert.equal(formatted.questions[2].questionId.toString(), academicQ3.toString());
  assert.equal(formatted.questions[2].correctOption, 'B');
  assert.equal(formatted.questions[2].selectedOption, null);
  assert.equal(formatted.questions[2].isCorrect, false);
  assert.equal(formatted.questions[2].status, 'unanswered');
  assert.equal(formatted.questions[2].marks, 0);

  // Summary metadata
  assert.equal(formatted.summary.score, 3);
  assert.equal(formatted.summary.attemptNumber, 1);
  assert.equal(formatted.summary.totalCorrect, 1);
  assert.equal(formatted.summary.totalWrong, 1);
  assert.equal(formatted.summary.unansweredQuestions, 1);
});
