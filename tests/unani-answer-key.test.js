const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const unaniExamService = require('../src/unani/exams/services/unaniExam.service');
const unaniExamController = require('../src/unani/exams/controllers/unaniExam.controller');
const { downloadAnswerKey } = require('../src/student/answerKey.controller');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const User = require('../models/User');
const examAttemptHelper = require('../utils/examAttemptHelper');
const courseAccessHelper = require('../utils/courseAccessHelper');

// Mock data fixtures
const mockStudentId = new mongoose.Types.ObjectId();
const mockOtherStudentId = new mongoose.Types.ObjectId();
const mockExamId = new mongoose.Types.ObjectId();
const mockResultId = new mongoose.Types.ObjectId();

const mockQ1Id = new mongoose.Types.ObjectId();
const mockQ2Id = new mongoose.Types.ObjectId();
const mockQ3Id = new mongoose.Types.ObjectId();

const mockStudentDoc = {
  _id: mockStudentId,
  name: 'Dr. Zaid Khan',
  email: 'zaid@example.com',
  courseId: 'unani',
  courseIds: ['unani'],
  enrolledCourses: ['unani'],
  enrolledCourseIds: ['unani'],
};

function mockQuery(val) {
  return {
    lean: async () => val,
    sort: function () { return this; },
    select: function () { return this; },
    populate: function () { return this; },
    then: function (resolve, reject) { return Promise.resolve(val).then(resolve, reject); },
  };
}

// Prevent Mongoose timeout in disconnected test runner
Student.findById = (id) => mockQuery({ ...mockStudentDoc, _id: new mongoose.Types.ObjectId(id) });
Student.findOne = () => mockQuery(mockStudentDoc);
Student.find = () => mockQuery([mockStudentDoc]);
User.findById = (id) => mockQuery({ ...mockStudentDoc, _id: new mongoose.Types.ObjectId(id) });
User.findOne = () => mockQuery(mockStudentDoc);
User.find = () => mockQuery([mockStudentDoc]);
examAttemptHelper.getStudentCandidateIds = async (user) => [new mongoose.Types.ObjectId(user.id || user._id || mockStudentId)];
courseAccessHelper.verifyStudentCourseAccessAny = async () => true;

const mockExamData = {
  _id: mockExamId,
  title: 'Unani Grand Mock Test 2026',
  courseId: 'unani',
  examType: 'grand_mock_test',
  marksPerQuestion: 4,
  negativeMark: 1,
  negativeMarkPenalty: 1,
  durationMinutes: 120,
  totalQuestions: 3,
  status: 'Published',
  questions: [
    {
      _id: mockQ1Id,
      questionText: 'Which temperament corresponds to Dam (Sanguine)?',
      passage: 'According to classical Unani medicine...',
      imageUrl: 'https://example.com/unani-q1.png',
      tableData: null,
      options: {
        A: 'Hot and Moist',
        B: 'Cold and Dry',
        C: 'Hot and Dry',
        D: 'Cold and Moist',
      },
      correctOption: 'A',
      explanation: 'Dam is Har-Ratab (Hot and Moist).',
    },
    {
      _id: mockQ2Id,
      questionText: 'Identify the principal organ for Quwwat-e-Nafsaniyah:',
      passage: null,
      imageUrl: null,
      tableData: { organ: 'Brain', system: 'Nervous' },
      options: {
        A: 'Heart (Qalb)',
        B: 'Brain (Dimagh)',
        C: 'Liver (Kabid)',
        D: 'Lungs (Riah)',
      },
      correctOption: 'B',
      explanation: 'Dimagh (Brain) is the seat of mental faculties.',
    },
    {
      _id: mockQ3Id,
      questionText: 'What is the primary humor associated with Balgham?',
      passage: null,
      imageUrl: null,
      tableData: null,
      options: {
        A: 'Phlegm',
        B: 'Blood',
        C: 'Yellow Bile',
        D: 'Black Bile',
      },
      correctOption: 'A',
      explanation: 'Balgham refers to Phlegm.',
    },
  ],
};

const mockResultData = {
  _id: mockResultId,
  studentId: mockStudentId,
  examId: mockExamId,
  courseId: 'unani',
  examType: 'grand_mock_test',
  score: 3, // Q1 correct (+4), Q2 wrong (-1), Q3 unanswered (0) => 3
  totalMarks: 12,
  percentage: 25,
  correctAnswers: 1,
  wrongAnswers: 1,
  unanswered: 1,
  status: 'Completed',
  timeTakenSeconds: 3600,
  createdAt: new Date('2026-10-15T10:00:00Z'),
  answers: [
    {
      questionId: mockQ1Id,
      selectedOption: 'A',
      correctOption: 'A',
      isCorrect: true,
    },
    {
      questionId: mockQ2Id,
      selectedOption: 'A', // wrong (correct is B)
      correctOption: 'B',
      isCorrect: false,
    },
    {
      questionId: mockQ3Id,
      selectedOption: null, // unanswered
      correctOption: 'A',
      isCorrect: false,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. FORMAT UNANI ANSWER KEY TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('1. formatUnaniAnswerKey correctly maps questions, options, student answers and scores', () => {
  const formatted = unaniExamService.formatUnaniAnswerKey(mockExamData, mockResultData);

  assert.equal(formatted.examId, mockExamId.toString());
  assert.equal(formatted.examTitle, 'Unani Grand Mock Test 2026');
  assert.equal(formatted.resultId, mockResultId.toString());
  assert.equal(formatted.studentId, mockStudentId.toString());
  assert.equal(formatted.score, 3);
  assert.equal(formatted.totalMarks, 12);
  assert.equal(formatted.percentage, 25);
  assert.equal(formatted.correctAnswers, 1);
  assert.equal(formatted.wrongAnswers, 1);
  assert.equal(formatted.unanswered, 1);
  assert.equal(formatted.attemptedQuestions, 2);
  assert.equal(formatted.totalQuestions, 3);

  // Check question 1 (Correct)
  const q1 = formatted.questions[0];
  assert.equal(q1.questionId, mockQ1Id.toString());
  assert.equal(q1.questionText, 'Which temperament corresponds to Dam (Sanguine)?');
  assert.equal(q1.passage, 'According to classical Unani medicine...');
  assert.equal(q1.imageUrl, 'https://example.com/unani-q1.png');
  assert.equal(q1.correctOption, 'A');
  assert.equal(q1.correctAnswer, 'Hot and Moist');
  assert.equal(q1.selectedOption, 'A');
  assert.equal(q1.studentAnswer, 'A');
  assert.equal(q1.selectedAnswer, 'Hot and Moist');
  assert.equal(q1.isCorrect, true);
  assert.equal(q1.isAttempted, true);
  assert.equal(q1.marksAwarded, 4);
  assert.equal(q1.explanation, 'Dam is Har-Ratab (Hot and Moist).');

  // Check question 2 (Wrong)
  const q2 = formatted.questions[1];
  assert.equal(q2.questionId, mockQ2Id.toString());
  assert.equal(q2.correctOption, 'B');
  assert.equal(q2.correctAnswer, 'Brain (Dimagh)');
  assert.equal(q2.selectedOption, 'A');
  assert.equal(q2.studentAnswer, 'A');
  assert.equal(q2.selectedAnswer, 'Heart (Qalb)');
  assert.equal(q2.isCorrect, false);
  assert.equal(q2.isAttempted, true);
  assert.equal(q2.marksAwarded, -1);
  assert.deepEqual(q2.tableData, { organ: 'Brain', system: 'Nervous' });

  // Check question 3 (Unanswered)
  const q3 = formatted.questions[2];
  assert.equal(q3.questionId, mockQ3Id.toString());
  assert.equal(q3.correctOption, 'A');
  assert.equal(q3.correctAnswer, 'Phlegm');
  assert.equal(q3.selectedOption, null);
  assert.equal(q3.studentAnswer, null);
  assert.equal(q3.selectedAnswer, null);
  assert.equal(q3.isCorrect, false);
  assert.equal(q3.isAttempted, false);
  assert.equal(q3.marksAwarded, 0);

  // Both questions and answers aliases present
  assert.equal(formatted.answers.length, 3);
  assert.equal(formatted.questions.length, 3);
});

test('2. formatUnaniAnswerKey supports master key when result is null', () => {
  const masterKey = unaniExamService.formatUnaniAnswerKey(mockExamData, null);

  assert.equal(masterKey.examId, mockExamId.toString());
  assert.equal(masterKey.resultId, null);
  assert.equal(masterKey.questions.length, 3);
  assert.equal(masterKey.questions[0].correctOption, 'A');
  assert.equal(masterKey.questions[0].selectedOption, null);
  assert.equal(masterKey.questions[0].isAttempted, false);
  assert.equal(masterKey.questions[0].marksAwarded, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. STUDENT ANSWER KEY RETRIEVAL & AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────

test('3. getStudentExamAnswerKey returns answer key for authorized student with completed attempt', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({
    lean: async () => mockExamData,
  });

  UnaniExamResult.findOne = (query) => ({
    sort: () => ({
      lean: async () => mockResultData,
    }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const reqUser = { id: mockStudentId.toString(), role: 'student' };
  const res = await unaniExamService.getStudentExamAnswerKey(mockExamId.toString(), reqUser);

  assert.equal(res.success, true);
  assert.equal(res.data.examId, mockExamId.toString());
  assert.equal(res.data.questions.length, 3);
  assert.equal(res.data.score, 3);
});

test('4. getStudentExamAnswerKey blocks student if attempt is not completed', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({
    lean: async () => mockExamData,
  });

  // No completed attempt found
  UnaniExamResult.findOne = () => ({
    sort: () => ({
      lean: async () => null,
    }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const reqUser = { id: mockStudentId.toString(), role: 'student' };
  const res = await unaniExamService.getStudentExamAnswerKey(mockExamId.toString(), reqUser);

  assert.equal(res.forbidden, true);
  assert.match(res.message, /completed attempt is required/i);
});

test("5. getStudentExamAnswerKey blocks student from accessing another student's resultId", async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({
    lean: async () => mockExamData,
  });

  UnaniExamResult.findOne = () => ({
    lean: async () => ({
      ...mockResultData,
      studentId: mockOtherStudentId, // belongs to someone else
    }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const reqUser = { id: mockStudentId.toString(), role: 'student' };
  const res = await unaniExamService.getStudentExamAnswerKey(mockExamId.toString(), reqUser, mockResultId.toString());

  assert.equal(res.forbidden, true);
  assert.match(res.message, /not authorized to view another student's answer key/i);
});

test('6. getStudentExamAnswerKey returns notFound for invalid examId', async () => {
  const res = await unaniExamService.getStudentExamAnswerKey('invalid-id', { role: 'student' });
  assert.equal(res.notFound, true);
});

test('7. getAdminExamAnswerKey allows admin to retrieve master answer key without taking exam', async (t) => {
  const origFindOneExam = UnaniExam.findOne;

  UnaniExam.findOne = () => ({
    lean: async () => mockExamData,
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
  });

  const reqUser = { role: 'admin' };
  const res = await unaniExamService.getAdminExamAnswerKey(mockExamId.toString(), reqUser, {});

  assert.equal(res.success, true);
  assert.equal(res.data.examId, mockExamId.toString());
  assert.equal(res.data.questions.length, 3);
  assert.equal(res.data.resultId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ADMIN ANSWER KEY MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

test('8. updateExamAnswerKey allows admin to bulk update correct options and explanations', async (t) => {
  const origFindOneExam = UnaniExam.findOne;

  let saved = false;
  const mockExamDoc = {
    ...mockExamData,
    questions: [
      {
        _id: mockQ1Id,
        correctOption: 'A',
        explanation: 'Old explanation',
      },
      {
        _id: mockQ2Id,
        correctOption: 'B',
        explanation: 'Old explanation',
      },
    ],
    save: async () => { saved = true; },
    toObject: function () { return this; },
  };
  mockExamDoc.questions.id = (id) => mockExamDoc.questions.find((q) => q._id.toString() === id.toString());

  UnaniExam.findOne = () => mockExamDoc;

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
  });

  const updatePayload = {
    answerKey: [
      {
        questionId: mockQ1Id.toString(),
        correctOption: 'B',
        explanation: 'Updated Har-Ratab explanation',
      },
      {
        questionId: mockQ2Id.toString(),
        correctOption: 'C',
        explanation: 'Updated organ explanation',
      },
    ],
  };

  const res = await unaniExamService.updateExamAnswerKey(mockExamId.toString(), updatePayload);

  assert.equal(res.success, true);
  assert.equal(res.updatedCount, 2);
  assert.equal(saved, true);
  assert.equal(mockExamDoc.questions[0].correctOption, 'B');
  assert.equal(mockExamDoc.questions[0].explanation, 'Updated Har-Ratab explanation');
  assert.equal(mockExamDoc.questions[1].correctOption, 'C');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. WATERMARKED PDF GENERATION
// ─────────────────────────────────────────────────────────────────────────────

test('9. generateUnaniAnswerKeyPDF produces a valid watermarked PDF buffer with student evaluation', async () => {
  const user = {
    id: mockStudentId.toString(),
    name: 'Dr. Zaid Khan',
    email: 'zaid@example.com',
    role: 'student',
  };

  const pdfBuffer = await unaniExamService.generateUnaniAnswerKeyPDF(mockExamData, user, mockResultData);

  assert.ok(Buffer.isBuffer(pdfBuffer), 'Result must be a Buffer');
  assert.ok(pdfBuffer.length > 5000, `Buffer should be non-trivial size, got ${pdfBuffer.length}`);
  // Verify PDF magic header bytes: %PDF-
  const header = pdfBuffer.slice(0, 5).toString('ascii');
  assert.equal(header, '%PDF-', 'PDF must begin with valid %PDF- magic bytes');
});

test('10. generateUnaniAnswerKeyPDF produces valid PDF without student result (Master Key)', async () => {
  const user = { name: 'Admin User', role: 'admin' };
  const pdfBuffer = await unaniExamService.generateUnaniAnswerKeyPDF(mockExamData, user, null);

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 5000);
  assert.equal(pdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CONTROLLER HANDLERS (GET ANSWER KEY & DOWNLOAD PDF)
// ─────────────────────────────────────────────────────────────────────────────

test('11. controller getAnswerKey returns HTTP 200 with formatted data for authorized attempt', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findOne = () => ({
    sort: () => ({ lean: async () => mockResultData }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const req = {
    params: { examId: mockExamId.toString() },
    user: { id: mockStudentId.toString(), role: 'student' },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.getAnswerKey(req, res);

  assert.equal(statusCode, 200);
  assert.equal(jsonBody.success, true);
  assert.equal(jsonBody.data.examId, mockExamId.toString());
  assert.equal(jsonBody.data.questions.length, 3);
});

test('12. controller downloadAnswerKeyPDF returns HTTP 200 with application/pdf and download headers', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findOne = () => ({
    sort: () => ({ lean: async () => mockResultData }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const req = {
    params: { examId: mockExamId.toString() },
    user: { id: mockStudentId.toString(), name: 'Dr. Zaid Khan', email: 'zaid@example.com', role: 'student' },
  };

  let statusCode = 0;
  let headers = {};
  let sentData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    send(data) {
      sentData = data;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.match(headers['content-disposition'], /attachment; filename="unani-.*\.pdf"/);
  assert.ok(headers['content-length'] > 0);
  assert.equal(headers['cache-control'], 'no-cache, no-store, must-revalidate');
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('13. controller downloadAnswerKeyPDF returns HTTP 403 when completed attempt is missing', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindOneResult = UnaniExamResult.findOne;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findOne = () => ({
    sort: () => ({ lean: async () => null }),
  });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findOne = origFindOneResult;
  });

  const req = {
    params: { examId: mockExamId.toString() },
    user: { id: mockStudentId.toString(), role: 'student' },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 403);
  assert.equal(jsonBody.success, false);
  assert.match(jsonBody.message, /completed attempt is required/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. RESULT SUMMARY SCREEN MODAL COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────

test('14. getStudentResultByExam includes populated answers and questions for Result Summary modal', async (t) => {
  const origFindOneResult = UnaniExamResult.findOne;
  const origFindByIdExam = UnaniExam.findById;

  UnaniExamResult.findOne = () => ({
    sort: () => mockResultData,
  });

  UnaniExam.findById = () => ({
    select: () => ({
      lean: async () => mockExamData,
    }),
  });

  t.after(() => {
    UnaniExamResult.findOne = origFindOneResult;
    UnaniExam.findById = origFindByIdExam;
  });

  const reqUser = { id: mockStudentId.toString(), role: 'student' };
  const res = await unaniExamService.getStudentResultByExam(mockExamId.toString(), reqUser);

  assert.equal(res.resultId, mockResultId.toString());
  assert.equal(res.examTitle, 'Unani Grand Mock Test 2026');
  assert.ok(Array.isArray(res.answers), 'answers must be an array');
  assert.ok(Array.isArray(res.questions), 'questions must be an array');
  assert.equal(res.answers.length, 3);
  assert.equal(res.questions.length, 3);
  assert.equal(res.answers[0].correctOption, 'A');
  assert.equal(res.answers[0].selectedOption, 'A');
  assert.equal(res.answers[0].isCorrect, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. STUDENT ANSWER KEY CONTROLLER FALLBACK FOR UNANI
// ─────────────────────────────────────────────────────────────────────────────

test('15. downloadAnswerKey fallback in answerKey.controller.js serves Unani exams', async (t) => {
  const origExamFindById = Exam.findById;
  const origUnaniFindById = UnaniExam.findById;
  const origUnaniResultFindOne = UnaniExamResult.findOne;

  // Exam.findById returns null (Not a Homeopathy exam)
  Exam.findById = () => ({
    lean: async () => null,
  });

  // UnaniExam.findById returns the Unani exam
  UnaniExam.findById = () => ({
    lean: async () => mockExamData,
  });

  // UnaniExamResult.findOne returns completed attempt
  UnaniExamResult.findOne = () => ({
    sort: () => ({
      lean: async () => mockResultData,
    }),
  });

  t.after(() => {
    Exam.findById = origExamFindById;
    UnaniExam.findById = origUnaniFindById;
    UnaniExamResult.findOne = origUnaniResultFindOne;
  });

  const req = {
    params: { id: mockExamId.toString() },
    user: {
      id: mockStudentId.toString(),
      studentId: mockStudentId.toString(),
      userId: mockStudentId.toString(),
      name: 'Dr. Zaid Khan',
      email: 'zaid@example.com',
      role: 'student',
      enrolledCourses: ['unani'],
    },
  };

  let statusCode = 0;
  let headers = {};
  let sentData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    send(data) {
      sentData = data;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await downloadAnswerKey(req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.match(headers['content-disposition'], /attachment; filename="unani-answer-key-watermarked\.pdf"/);
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. RESULT-SPECIFIC ROUTES & SECURITY REGRESSION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('16. controller getAnswerKey with valid examId & resultId returns HTTP 200 with JSON answer key', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mockResultData });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: {
      examId: mockExamId.toString(),
      resultId: mockResultId.toString(),
    },
    user: {
      id: mockStudentId.toString(),
      studentId: mockStudentId.toString(),
      role: 'student',
    },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.getAnswerKey(req, res);

  assert.equal(statusCode, 200);
  assert.equal(jsonBody.success, true);
  assert.equal(jsonBody.data.examId, mockExamId.toString());
  assert.equal(jsonBody.data.resultId, mockResultId.toString());
  assert.equal(jsonBody.data.questions.length, 3);
});

test('17. controller downloadAnswerKeyPDF with valid examId & resultId returns HTTP 200 with watermarked PDF', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mockResultData });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: {
      examId: mockExamId.toString(),
      resultId: mockResultId.toString(),
    },
    user: {
      id: mockStudentId.toString(),
      studentId: mockStudentId.toString(),
      name: 'unanitest',
      email: 'unanitest@gmail.com',
      role: 'student',
    },
  };

  let statusCode = 0;
  let headers = {};
  let sentData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    send(data) {
      sentData = data;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('18. getStudentExamAnswerKey with invalid examId returns notFound', async () => {
  const res = await unaniExamService.getStudentExamAnswerKey('invalid-id', { id: mockStudentId.toString(), role: 'student' });
  assert.equal(res.notFound, true);
  assert.match(res.message, /Invalid or missing Exam ID/i);
});

test('19. getStudentExamAnswerKey with invalid or nonexistent resultId returns notFound', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => null });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const res = await unaniExamService.getStudentExamAnswerKey(
    mockExamId.toString(),
    { id: mockStudentId.toString(), role: 'student' },
    new mongoose.Types.ObjectId().toString()
  );
  assert.equal(res.notFound, true);
  assert.match(res.message, /Unani exam result not found/i);
});

test('20. getStudentExamAnswerKey with mismatched exam and result pair returns notFound with specific mismatch message', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  const differentExamId = new mongoose.Types.ObjectId();
  const mismatchedResult = {
    ...mockResultData,
    examId: differentExamId, // Belongs to a different exam!
  };

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mismatchedResult });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const res = await unaniExamService.getStudentExamAnswerKey(
    mockExamId.toString(),
    { id: mockStudentId.toString(), role: 'student' },
    mockResultId.toString()
  );
  assert.equal(res.notFound, true);
  assert.match(res.message, /does not belong to this exam/i);
});

test('21. getStudentExamAnswerKey blocks student from viewing another student resultId (403)', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mockResultData }); // studentId: mockStudentId

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  // A different student attempts to view mockStudentId's resultId
  const attackerUser = {
    id: mockOtherStudentId.toString(),
    studentId: mockOtherStudentId.toString(),
    role: 'student',
  };

  const res = await unaniExamService.getStudentExamAnswerKey(
    mockExamId.toString(),
    attackerUser,
    mockResultId.toString()
  );
  assert.equal(res.forbidden, true);
  assert.match(res.message, /not authorized to view another student/i);
});

test('22. downloadAnswerKeyPDF with valid examId & resultId in query returns 200 and application/pdf headers', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mockResultData });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: { examId: mockExamId.toString() },
    query: { resultId: mockResultId.toString() },
    user: {
      id: mockStudentId.toString(),
      studentId: mockStudentId.toString(),
      name: 'unanitest',
      email: 'unanitest@gmail.com',
      role: 'student',
    },
  };

  let statusCode = 0;
  let headers = {};
  let sentData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key.toLowerCase()] = val;
    },
    send(data) {
      sentData = data;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.match(headers['content-disposition'], /attachment; filename="unani-.*-answer-key\.pdf"/);
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('23. downloadAnswerKeyPDF returns 404 when source exam does not exist', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  UnaniExam.findOne = () => ({ lean: async () => null });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
  });

  const req = {
    params: {
      examId: new mongoose.Types.ObjectId().toString(),
      resultId: mockResultId.toString(),
    },
    user: {
      id: mockStudentId.toString(),
      role: 'student',
    },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 404);
  assert.equal(jsonBody.success, false);
  assert.match(jsonBody.message, /Unani exam not found/i);
});

test('24. downloadAnswerKeyPDF returns 404 when result does not belong to the requested exam', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  const differentExamId = new mongoose.Types.ObjectId();
  const mismatchedResult = {
    ...mockResultData,
    examId: differentExamId,
  };

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mismatchedResult });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: {
      examId: mockExamId.toString(),
      resultId: mockResultId.toString(),
    },
    user: {
      id: mockStudentId.toString(),
      role: 'student',
    },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 404);
  assert.equal(jsonBody.success, false);
  assert.match(jsonBody.message, /does not belong to this exam/i);
});

test('25. downloadAnswerKeyPDF returns 403 when student tries to download another student answer key', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => mockResultData }); // studentId: mockStudentId

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: {
      examId: mockExamId.toString(),
      resultId: mockResultId.toString(),
    },
    user: {
      id: mockOtherStudentId.toString(),
      studentId: mockOtherStudentId.toString(),
      role: 'student',
    },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 403);
  assert.equal(jsonBody.success, false);
  assert.match(jsonBody.message, /not authorized to view another student/i);
});

test('26. downloadAnswerKeyPDF returns 404 when requested resultId is not found', async (t) => {
  const origFindOneExam = UnaniExam.findOne;
  const origFindByIdResult = UnaniExamResult.findById;

  UnaniExam.findOne = () => ({ lean: async () => mockExamData });
  UnaniExamResult.findById = () => ({ lean: async () => null });

  t.after(() => {
    UnaniExam.findOne = origFindOneExam;
    UnaniExamResult.findById = origFindByIdResult;
  });

  const req = {
    params: {
      examId: mockExamId.toString(),
      resultId: new mongoose.Types.ObjectId().toString(),
    },
    user: {
      id: mockStudentId.toString(),
      role: 'student',
    },
  };

  let statusCode = 0;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  await unaniExamController.downloadAnswerKeyPDF(req, res);

  assert.equal(statusCode, 404);
  assert.equal(jsonBody.success, false);
  assert.match(jsonBody.message, /Unani exam result not found/i);
});


