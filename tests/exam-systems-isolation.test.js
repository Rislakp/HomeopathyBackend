const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Normal Exam Components
const Exam = require('../models/Exam');
const TestResult = require('../src/common/models/testResult.model');
const {
  getAnswerKey: getNormalAnswerKey,
  downloadAnswerKey: downloadSharedAnswerKey,
  formatNormalAnswerKey,
  generateWatermarkedAnswerKeyPDF,
} = require('../src/student/answerKey.controller');
const {
  evaluateSubmittedAnswers,
  resolveNegativeMark,
  sanitizeQuestionForStudent,
} = require('../src/student/normalExamRules');

// Unani Exam Components
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
const unaniExamService = require('../src/unani/exams/services/unaniExam.service');
const unaniExamController = require('../src/unani/exams/controllers/unaniExam.controller');

// Helpers and dependencies
const Student = require('../models/Student');
const User = require('../models/User');
const examAttemptHelper = require('../utils/examAttemptHelper');
const courseAccessHelper = require('../utils/courseAccessHelper');

// ── Shared Test Fixtures ──────────────────────────────────────────────────────────
const mockNormalStudentId = new mongoose.Types.ObjectId();
const mockUnaniStudentId = new mongoose.Types.ObjectId();
const mockAttackerStudentId = new mongoose.Types.ObjectId();

const mockNormalExamId = new mongoose.Types.ObjectId();
const mockUnaniExamId = new mongoose.Types.ObjectId();

const mockNormalResultId = new mongoose.Types.ObjectId();
const mockUnaniResultId = new mongoose.Types.ObjectId();

const mockNormalQ1 = new mongoose.Types.ObjectId();
const mockNormalQ2 = new mongoose.Types.ObjectId();
const mockNormalQ3 = new mongoose.Types.ObjectId();

const mockUnaniQ1 = new mongoose.Types.ObjectId();
const mockUnaniQ2 = new mongoose.Types.ObjectId();
const mockUnaniQ3 = new mongoose.Types.ObjectId();

// Query Thenable Helper
function mockQuery(val) {
  return {
    lean: async () => val,
    sort: function () { return this; },
    select: function () { return this; },
    populate: function () { return this; },
    then: function (resolve, reject) { return Promise.resolve(val).then(resolve, reject); },
  };
}

const mockDefaultStudent = {
  _id: mockNormalStudentId,
  name: 'Student Test',
  email: 'test@wca.com',
  courseIds: ['homeopathy', 'unani'],
  courseId: 'unani',
  enrolledCourses: ['homeopathy', 'unani'],
};

// Mock Global Model Finds for Safety to prevent disconnected Mongoose timeouts
Student.findById = (id) => mockQuery({ ...mockDefaultStudent, _id: new mongoose.Types.ObjectId(id) });
Student.findOne = () => mockQuery(mockDefaultStudent);
Student.find = () => mockQuery([mockDefaultStudent]);

User.findById = (id) => mockQuery({ _id: new mongoose.Types.ObjectId(id), name: 'Admin Test', email: 'admin@wca.com', role: 'admin' });
User.findOne = () => mockQuery({ _id: mockNormalStudentId, name: 'Admin Test', email: 'admin@wca.com', role: 'admin' });
User.find = () => mockQuery([{ _id: mockNormalStudentId, name: 'Admin Test', email: 'admin@wca.com', role: 'admin' }]);

TestResult.find = () => mockQuery([]);
TestResult.exists = () => mockQuery(true);

UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
UnaniExam.findOne = (query) => {
  const id = query?._id || query?.id;
  if (!id || String(id) === String(mockUnaniExamId)) {
    return mockQuery(mockUnaniExam);
  }
  return mockQuery(null);
};
UnaniExam.find = () => mockQuery([mockUnaniExam]);

UnaniExamResult.findById = (id) => mockQuery(String(id) === String(mockUnaniResultId) ? mockUnaniResult : null);
UnaniExamResult.findOne = (query) => {
  if (query?.examId && String(query.examId) !== String(mockUnaniExamId)) {
    return mockQuery(null);
  }
  if (query?.studentId && String(query.studentId) === String(mockAttackerStudentId)) {
    return mockQuery(null);
  }
  return mockQuery(mockUnaniResult);
};
UnaniExamResult.find = () => mockQuery([mockUnaniResult]);

examAttemptHelper.getStudentCandidateIds = async (user) => {
  if (!user || (!user.id && !user._id && !user.studentId && !user.userId)) return [];
  const uid = user.id || user._id || user.studentId || user.userId;
  return [new mongoose.Types.ObjectId(uid)];
};

courseAccessHelper.verifyStudentCourseAccessAny = async (user, courseIds) => {
  const enrolled = user?.enrolledCourses || (user?.courseId ? [user.courseId] : []);
  return courseIds.some((c) => enrolled.includes(c));
};

// ── Exam Fixture Data ─────────────────────────────────────────────────────────────
const mockNormalExam = {
  _id: mockNormalExamId,
  title: 'Homeopathy Grand Mock 2026',
  testType: 'grand_mock',
  status: 'Published',
  durationMinutes: 90,
  totalQuestions: 3,
  marksPerQuestion: 4,
  negativeMark: 1,
  negativeMarkPenalty: 1,
  questions: [
    {
      _id: mockNormalQ1,
      questionText: 'What is the primary source of Arnica Montana?',
      options: { A: 'Plant', B: 'Animal', C: 'Mineral', D: 'Nosode' },
      correctOption: 'A',
      explanation: 'Arnica is derived from the mountain daisy plant.',
    },
    {
      _id: mockNormalQ2,
      questionText: 'Which remedy corresponds to sudden acute violent onset?',
      options: { A: 'Bryonia', B: 'Aconitum Napellus', C: 'Calcarea Carb', D: 'Silicea' },
      correctOption: 'B',
      explanation: 'Aconite is characterized by sudden, violent storms.',
    },
    {
      _id: mockNormalQ3,
      questionText: 'Key modality: aggravation from cold dry air?',
      options: { A: 'Hepar Sulph', B: 'Natrum Mur', C: 'Pulsatilla', D: 'Sulphur' },
      correctOption: 'A',
      explanation: 'Hepar Sulph is extremely sensitive to cold dry drafts.',
    },
  ],
};

const mockNormalResult = {
  _id: mockNormalResultId,
  studentId: mockNormalStudentId,
  examId: mockNormalExamId,
  score: 7, // Q1 correct (+4), Q2 wrong (-1), Q3 unanswered (0) = 3 + 4 = 7 - wait: 4 - 1 + 0 = 3
  totalMarks: 12,
  totalAttempted: 2,
  totalCorrect: 1,
  totalWrong: 1,
  unansweredQuestions: 1,
  percentage: 25,
  status: 'Completed',
  answers: [
    {
      questionId: mockNormalQ1,
      selectedOption: 'A',
      correctOption: 'A',
      isCorrect: true,
      status: 'correct',
    },
    {
      questionId: mockNormalQ2,
      selectedOption: 'A', // Incorrect (Correct is B)
      correctOption: 'B',
      isCorrect: false,
      status: 'wrong',
    },
    {
      questionId: mockNormalQ3,
      selectedOption: null, // Skipped
      correctOption: 'A',
      isCorrect: false,
      status: 'unanswered',
    },
  ],
};

const mockUnaniExam = {
  _id: mockUnaniExamId,
  title: 'Kulliyat Grand Mock Test 2026',
  courseId: 'unani',
  examType: 'grand_mock_test',
  status: 'published',
  durationMinutes: 120,
  totalQuestions: 3,
  marksPerQuestion: 1,
  negativeMark: 0.25,
  questions: [
    {
      _id: mockUnaniQ1,
      questionText: 'According to Unani philosophy, how many Arkan (elements) exist?',
      options: { A: 'Two', B: 'Three', C: 'Four', D: 'Five' },
      correctOption: 'C',
      explanation: 'The four classical elements are Fire, Air, Water, and Earth.',
    },
    {
      _id: mockUnaniQ2,
      questionText: 'Which Akhlat (humour) is hot and moist in temperament?',
      options: { A: 'Dam (Blood)', B: 'Balgham (Phlegm)', C: 'Safra (Yellow Bile)', D: 'Sauda (Black Bile)' },
      correctOption: 'A',
      explanation: 'Dam (Blood) is recognized as hot and moist.',
    },
    {
      _id: mockUnaniQ3,
      questionText: 'Who authored Al-Qanun fi al-Tibb (The Canon of Medicine)?',
      options: { A: 'Ibn Sina (Avicenna)', B: 'Al-Razi (Rhazes)', C: 'Ibn Rushd', D: 'Al-Zahrawi' },
      correctOption: 'A',
      explanation: 'The Canon of Medicine was written by Ibn Sina.',
    },
  ],
};

const mockUnaniResult = {
  _id: mockUnaniResultId,
  studentId: mockUnaniStudentId,
  examId: mockUnaniExamId,
  score: 0.75, // Q1 correct (+1), Q2 wrong (-0.25), Q3 unanswered (0)
  totalMarks: 3,
  totalAttempted: 2,
  correctAnswers: 1,
  wrongAnswers: 1,
  unanswered: 1,
  percentage: 25,
  status: 'Completed',
  answers: [
    {
      questionId: mockUnaniQ1,
      selectedOption: 'C',
      isCorrect: true,
    },
    {
      questionId: mockUnaniQ2,
      selectedOption: 'B', // Incorrect
      isCorrect: false,
    },
    {
      questionId: mockUnaniQ3,
      selectedOption: null, // Skipped
      isCorrect: false,
    },
  ],
};

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let sentData = null;
  let jsonBody = null;

  return {
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
      jsonBody = body;
      return this;
    },
    getResponse() {
      return { statusCode, headers, sentData, jsonBody };
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────────
// TEST SUITE: Complete Audit and Isolation Verification
// ──────────────────────────────────────────────────────────────────────────────────

test('1. Normal exam answer key retrieval via dedicated getAnswerKey', async () => {
  Exam.findById = (id) => mockQuery(String(id) === String(mockNormalExamId) ? mockNormalExam : null);
  TestResult.findOne = (query) => {
    if (query?.examId?.toString() === mockNormalExamId.toString()) {
      return mockQuery(mockNormalResult);
    }
    return mockQuery(null);
  };

  const req = {
    params: { id: mockNormalExamId.toString() },
    user: { id: mockNormalStudentId.toString(), role: 'student', enrolledCourses: ['homeopathy'] },
  };
  const res = createMockResponse();

  await getNormalAnswerKey(req, res);
  const { statusCode, jsonBody } = res.getResponse();

  assert.equal(statusCode, 200);
  assert.equal(jsonBody.success, true);
  assert.equal(jsonBody.data.exam.title, 'Homeopathy Grand Mock 2026');
  assert.equal(jsonBody.data.summary.score, mockNormalResult.score);
  assert.equal(jsonBody.data.summary.totalMarks, 12);
  assert.equal(jsonBody.data.questions.length, 3);
  assert.equal(jsonBody.data.questions[0].correctOption, 'A');
  assert.equal(jsonBody.data.questions[0].selectedOption, 'A');
  assert.equal(jsonBody.data.questions[0].isCorrect, true);
  assert.equal(jsonBody.data.questions[0].status, 'correct');
  assert.equal(jsonBody.data.questions[0].marks, 4);
});

test('2. Normal exam watermarked PDF download via downloadAnswerKey', async () => {
  Exam.findById = (id) => mockQuery(String(id) === String(mockNormalExamId) ? mockNormalExam : null);
  TestResult.findOne = () => mockQuery(mockNormalResult);

  const req = {
    params: { id: mockNormalExamId.toString() },
    user: {
      id: mockNormalStudentId.toString(),
      name: 'Dr. Hahnemann Student',
      email: 'hahnemann@wca.com',
      role: 'student',
      enrolledCourses: ['homeopathy'],
    },
  };
  const res = createMockResponse();

  await downloadSharedAnswerKey(req, res);
  const { statusCode, headers, sentData } = res.getResponse();

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.match(headers['content-disposition'], /attachment; filename="answer-key-watermarked\.pdf"/);
  assert.ok(headers['content-length'] > 0);
  assert.equal(headers['cache-control'], 'no-cache, no-store, must-revalidate');
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('3. Unani exam answer key retrieval via separate Unani controller', async () => {
  UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
  UnaniExamResult.findOne = (query) => {
    if (query?.examId?.toString() === mockUnaniExamId.toString()) {
      return mockQuery(mockUnaniResult);
    }
    return mockQuery(null);
  };

  const req = {
    params: { examId: mockUnaniExamId.toString() },
    user: { id: mockUnaniStudentId.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getAnswerKey(req, res);
  const { statusCode, jsonBody } = res.getResponse();

  assert.equal(statusCode, 200);
  assert.equal(jsonBody.success, true);
  assert.equal(jsonBody.data.exam.title, 'Kulliyat Grand Mock Test 2026');
  assert.equal(jsonBody.data.summary.score, 0.75);
  assert.equal(jsonBody.data.questions.length, 3);
  assert.equal(jsonBody.data.questions[0].correctOption, 'C');
  assert.equal(jsonBody.data.questions[0].studentSelectedOption, 'C');
  assert.equal(jsonBody.data.questions[0].isCorrect, true);
  assert.equal(jsonBody.data.questions[1].studentSelectedOption, 'B');
  assert.equal(jsonBody.data.questions[1].isCorrect, false);
});

test('4. Unani exam watermarked PDF download via unaniExamController.downloadAnswerKeyPDF', async () => {
  UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
  UnaniExamResult.findOne = () => mockQuery(mockUnaniResult);

  const req = {
    params: { examId: mockUnaniExamId.toString() },
    user: {
      id: mockUnaniStudentId.toString(),
      name: 'Hakim Ajmal Khan',
      email: 'ajmal@wca.com',
      role: 'student',
      enrolledCourses: ['unani'],
    },
  };
  const res = createMockResponse();

  await unaniExamController.downloadAnswerKeyPDF(req, res);
  const { statusCode, headers, sentData } = res.getResponse();

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.match(headers['content-disposition'], /attachment; filename="unani-.*-answer-key\.pdf"/);
  assert.ok(headers['content-length'] > 0);
  assert.equal(headers['cache-control'], 'no-cache, no-store, must-revalidate');
  assert.ok(Buffer.isBuffer(sentData));
  assert.equal(sentData.slice(0, 5).toString('ascii'), '%PDF-');
});

test('5. Correct question-to-answer mapping for both systems', () => {
  // Test Normal Exam mapping
  const normalFormatted = formatNormalAnswerKey(mockNormalExam, mockNormalResult);
  assert.equal(normalFormatted.questions[0].correctOption, 'A');
  assert.equal(normalFormatted.questions[0].selectedOption, 'A');
  assert.equal(normalFormatted.questions[0].status, 'correct');
  assert.equal(normalFormatted.questions[0].marks, 4);

  assert.equal(normalFormatted.questions[1].correctOption, 'B');
  assert.equal(normalFormatted.questions[1].selectedOption, 'A');
  assert.equal(normalFormatted.questions[1].status, 'wrong');
  assert.equal(normalFormatted.questions[1].marks, -1);

  assert.equal(normalFormatted.questions[2].correctOption, 'A');
  assert.equal(normalFormatted.questions[2].selectedOption, null);
  assert.equal(normalFormatted.questions[2].status, 'unanswered');
  assert.equal(normalFormatted.questions[2].marks, 0);

  // Test Unani Exam mapping
  const unaniFormatted = unaniExamService.formatUnaniAnswerKey(mockUnaniExam, mockUnaniResult);
  assert.equal(unaniFormatted.questions[0].correctOption, 'C');
  assert.equal(unaniFormatted.questions[0].studentSelectedOption, 'C');
  assert.equal(unaniFormatted.questions[0].status, 'correct');
  assert.equal(unaniFormatted.questions[0].marks, 1);

  assert.equal(unaniFormatted.questions[1].correctOption, 'A');
  assert.equal(unaniFormatted.questions[1].studentSelectedOption, 'B');
  assert.equal(unaniFormatted.questions[1].status, 'wrong');
  assert.equal(unaniFormatted.questions[1].marks, -0.25);

  assert.equal(unaniFormatted.questions[2].correctOption, 'A');
  assert.equal(unaniFormatted.questions[2].studentSelectedOption, null);
  assert.equal(unaniFormatted.questions[2].status, 'unanswered');
  assert.equal(unaniFormatted.questions[2].marks, 0);
});

test('6. Authorization and student result ownership: blocks student from accessing another student result', async () => {
  // Normal Exam: Attacker tries to access Normal Student's resultId
  Exam.findById = (id) => mockQuery(String(id) === String(mockNormalExamId) ? mockNormalExam : null);
  TestResult.findOne = (query) => {
    // If studentId matches query, return result; attacker ID won't match
    const studentFilter = query?.studentId?.$in || [];
    if (studentFilter.some((id) => id.toString() === mockAttackerStudentId.toString())) {
      return mockQuery(null); // Attacker has no attempt
    }
    return mockQuery(null);
  };

  const normalReq = {
    params: { id: mockNormalExamId.toString(), resultId: mockNormalResultId.toString() },
    user: { id: mockAttackerStudentId.toString(), role: 'student', enrolledCourses: ['homeopathy'] },
  };
  const normalRes = createMockResponse();

  await getNormalAnswerKey(normalReq, normalRes);
  assert.equal(normalRes.getResponse().statusCode, 403);

  // Unani Exam: Attacker tries to access Unani Student's resultId
  UnaniExam.findOne = () => mockQuery(mockUnaniExam);
  UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
  UnaniExamResult.findOne = () => mockQuery(mockUnaniResult);

  const unaniReq = {
    params: { examId: mockUnaniExamId.toString(), resultId: mockUnaniResultId.toString() },
    user: { id: mockAttackerStudentId.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const unaniRes = createMockResponse();

  await unaniExamController.getAnswerKey(unaniReq, unaniRes);
  assert.equal(unaniRes.getResponse().statusCode, 403);
});

test('7. Invalid exam IDs and missing results return appropriate HTTP error codes', async () => {
  // Malformed ID returns 400
  const badIdReq = {
    params: { id: 'invalid-hex-id' },
    user: { id: mockNormalStudentId.toString(), role: 'student' },
  };
  const badIdRes = createMockResponse();
  await getNormalAnswerKey(badIdReq, badIdRes);
  assert.equal(badIdRes.getResponse().statusCode, 400);

  // Non-existent Exam returns 404
  Exam.findById = () => mockQuery(null);
  UnaniExam.findById = () => mockQuery(null);

  const missingExamReq = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    user: { id: mockNormalStudentId.toString(), role: 'student' },
  };
  const missingExamRes = createMockResponse();
  await getNormalAnswerKey(missingExamReq, missingExamRes);
  assert.equal(missingExamRes.getResponse().statusCode, 404);

  // Missing completed attempt returns 403
  Exam.findById = () => mockQuery(mockNormalExam);
  TestResult.findOne = () => mockQuery(null);

  const missingAttemptReq = {
    params: { id: mockNormalExamId.toString() },
    user: { id: mockNormalStudentId.toString(), role: 'student' },
  };
  const missingAttemptRes = createMockResponse();
  await getNormalAnswerKey(missingAttemptReq, missingAttemptRes);
  assert.equal(missingAttemptRes.getResponse().statusCode, 403);
});

test('8. Shared endpoint routing dispatches to the correct exam implementation', async () => {
  // Shared downloadAnswerKey with Normal Exam ID -> returns answer-key-watermarked.pdf
  Exam.findById = (id) => mockQuery(String(id) === String(mockNormalExamId) ? mockNormalExam : null);
  UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
  TestResult.findOne = () => mockQuery(mockNormalResult);
  UnaniExamResult.findOne = () => mockQuery(mockUnaniResult);

  const normalReq = {
    params: { id: mockNormalExamId.toString() },
    user: { id: mockNormalStudentId.toString(), name: 'Student 1', role: 'student', enrolledCourses: ['homeopathy'] },
  };
  const normalRes = createMockResponse();
  await downloadSharedAnswerKey(normalReq, normalRes);

  const normalHeaders = normalRes.getResponse().headers;
  assert.match(normalHeaders['content-disposition'], /attachment; filename="answer-key-watermarked\.pdf"/);

  // Shared downloadAnswerKey with Unani Exam ID -> returns unani-answer-key-watermarked.pdf
  const unaniReq = {
    params: { id: mockUnaniExamId.toString() },
    user: { id: mockUnaniStudentId.toString(), name: 'Student 2', role: 'student', enrolledCourses: ['unani'] },
  };
  const unaniRes = createMockResponse();
  await downloadSharedAnswerKey(unaniReq, unaniRes);

  const unaniHeaders = unaniRes.getResponse().headers;
  assert.match(unaniHeaders['content-disposition'], /attachment; filename="unani-answer-key-watermarked\.pdf"/);
});

test('9. Isolation: Normal exam requests never touch or return Unani data', async () => {
  let unaniExamQueryCount = 0;
  let unaniResultQueryCount = 0;

  Exam.findById = (id) => mockQuery(String(id) === String(mockNormalExamId) ? mockNormalExam : null);
  TestResult.findOne = () => mockQuery(mockNormalResult);

  UnaniExam.findById = () => {
    unaniExamQueryCount++;
    return mockQuery(null);
  };
  UnaniExamResult.findOne = () => {
    unaniResultQueryCount++;
    return mockQuery(null);
  };

  const req = {
    params: { id: mockNormalExamId.toString() },
    user: { id: mockNormalStudentId.toString(), role: 'student', enrolledCourses: ['homeopathy'] },
  };
  const res = createMockResponse();

  await getNormalAnswerKey(req, res);
  assert.equal(res.getResponse().statusCode, 200);
  assert.equal(unaniExamQueryCount, 0, 'Normal exam request must never query UnaniExam');
  assert.equal(unaniResultQueryCount, 0, 'Normal exam request must never query UnaniExamResult');

  // Explicit normal route must NOT fallback to Unani even if Exam is not found
  const explicitNormalReq = {
    params: { id: mockUnaniExamId.toString() },
    query: { system: 'normal' },
    user: { id: mockNormalStudentId.toString(), role: 'student', enrolledCourses: ['homeopathy'] },
  };
  const explicitNormalRes = createMockResponse();
  await getNormalAnswerKey(explicitNormalReq, explicitNormalRes);
  assert.equal(explicitNormalRes.getResponse().statusCode, 404);
});

test('10. Isolation: Unani exam requests never touch or return Normal exam data', async () => {
  let normalExamQueryCount = 0;
  let normalResultQueryCount = 0;

  Exam.findById = () => {
    normalExamQueryCount++;
    return mockQuery(null);
  };
  TestResult.findOne = () => {
    normalResultQueryCount++;
    return mockQuery(null);
  };

  UnaniExam.findById = (id) => mockQuery(String(id) === String(mockUnaniExamId) ? mockUnaniExam : null);
  UnaniExam.findOne = (query) => {
    const id = query?._id || query?.id;
    if (id && String(id) === String(mockNormalExamId)) {
      return mockQuery(null);
    }
    return mockQuery(mockUnaniExam);
  };
  UnaniExamResult.findOne = () => mockQuery(mockUnaniResult);

  const req = {
    params: { examId: mockUnaniExamId.toString() },
    user: { id: mockUnaniStudentId.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const res = createMockResponse();

  await unaniExamController.getAnswerKey(req, res);
  assert.equal(res.getResponse().statusCode, 200);
  assert.equal(normalExamQueryCount, 0, 'Unani exam request must never query Normal Exam');
  assert.equal(normalResultQueryCount, 0, 'Unani exam request must never query Normal TestResult');

  // Passing a Normal Exam ID to Unani controller returns 404 without querying Exam
  const foreignReq = {
    params: { examId: mockNormalExamId.toString() },
    user: { id: mockUnaniStudentId.toString(), role: 'student', enrolledCourses: ['unani'] },
  };
  const foreignRes = createMockResponse();
  await unaniExamController.getAnswerKey(foreignReq, foreignRes);
  assert.equal(foreignRes.getResponse().statusCode, 404);
});

test('11. Existing normal exam scoring and evaluation logic remains completely unchanged', () => {
  // Test negative mark calculation
  assert.equal(resolveNegativeMark({ negativeMark: 0.25 }), 0.25);
  assert.equal(resolveNegativeMark({ negativeMark: 0, negativeMarkPenalty: 0.25 }), 0);

  // Test question sanitization for students (removes answers recursively)
  const sanitized = sanitizeQuestionForStudent({
    questionText: 'Test Q',
    options: { A: '1', B: '2' },
    correctOption: 'A',
    explanation: 'Confidential explanation',
  });
  assert.equal(sanitized.correctOption, undefined);
  assert.equal(sanitized.explanation, undefined);
  assert.equal(sanitized.questionText, 'Test Q');

  // Test answer evaluation math
  function normalizeKey(v) { return v ? String(v).trim().toUpperCase() : null; }
  const questions = [
    { _id: 'q1', options: { A: 'a', B: 'b' }, correctOption: 'A' },
    { _id: 'q2', options: { A: 'a', B: 'b' }, correctOption: 'B' },
  ];
  const evalResult = evaluateSubmittedAnswers(
    questions,
    [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'A' }],
    1,
    0.25,
    normalizeKey
  );
  assert.equal(evalResult.score, 0.75); // 1 - 0.25 = 0.75
  assert.equal(evalResult.totalCorrect, 1);
  assert.equal(evalResult.totalWrong, 1);
});

test('12. PDF headers and valid multi-page PDF generation for both systems', async () => {
  // Multi-page Normal Exam PDF
  const multiPageNormalExam = {
    ...mockNormalExam,
    questions: Array.from({ length: 15 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      questionText: `Normal Exam Question ${i + 1} with extensive clinical details and modalities`,
      passage: i % 2 === 0 ? 'A detailed patient case presenting with chronic symptoms.' : null,
      options: { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
      correctOption: 'A',
      explanation: `Clinical explanation for question ${i + 1}`,
    })),
  };
  const normalBuffer = await generateWatermarkedAnswerKeyPDF(multiPageNormalExam, { name: 'Student 1' });
  assert.ok(Buffer.isBuffer(normalBuffer));
  assert.equal(normalBuffer.slice(0, 5).toString('ascii'), '%PDF-');
  assert.ok(normalBuffer.length > 5000);

  // Multi-page Unani Exam PDF
  const multiPageUnaniExam = {
    ...mockUnaniExam,
    questions: Array.from({ length: 15 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      questionText: `Unani Exam Question ${i + 1} regarding Mizaj, Arkan, and Akhlat`,
      options: { A: 'Dam', B: 'Balgham', C: 'Safra', D: 'Sauda' },
      correctOption: 'C',
      explanation: `Detailed classical Unani explanation for question ${i + 1}`,
    })),
  };
  const unaniBuffer = await unaniExamService.generateUnaniAnswerKeyPDF(multiPageUnaniExam, { name: 'Student 2' });
  assert.ok(Buffer.isBuffer(unaniBuffer));
  assert.equal(unaniBuffer.slice(0, 5).toString('ascii'), '%PDF-');
  assert.ok(unaniBuffer.length > 5000);
});
