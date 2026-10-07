const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeQuestionForStudent,
  resolveNegativeMark,
  evaluateSubmittedAnswers,
} = require('../src/student/normalExamRules');

function normalizeOptionKey(value, options = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const key = String(value).trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(key)) return key;
  const index = Number(key);
  if (/^\d+$/.test(key) && index >= 0 && index <= 3) return ['A', 'B', 'C', 'D'][index];
  return Object.keys(options).find((option) => String(options[option]).trim().toLowerCase() === key.toLowerCase()) || null;
}

function makeQuestions(count) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `question-${index + 1}`,
    questionText: `Question ${index + 1}`,
    options: { A: 'alpha', B: 'beta', C: 'gamma', D: 'delta' },
    correctOption: 'A',
  }));
}

function scorePattern(correct, wrong, unanswered, mark = 1, penalty = 0.25) {
  const questions = makeQuestions(correct + wrong + unanswered);
  const answers = [
    ...questions.slice(0, correct).map((q) => ({ questionId: q._id, selectedOption: 'A' })),
    ...questions.slice(correct, correct + wrong).map((q) => ({ questionId: q._id, selectedOption: 'B' })),
  ];
  return evaluateSubmittedAnswers(questions, answers, mark, penalty, normalizeOptionKey);
}

test('student question serialization removes answer material recursively', () => {
  const safe = sanitizeQuestionForStudent({
    questionText: 'Q',
    options: { A: 'one', B: 'two' },
    correctOption: 'A',
    explanation: 'because',
    nested: { answerKey: 'A', rationale: 'secret', retained: true },
  });
  assert.deepEqual(safe, {
    questionText: 'Q',
    options: { A: 'one', B: 'two' },
    nested: { retained: true },
  });
});

test('negative mark supports current and legacy fields without overriding explicit zero', () => {
  assert.equal(resolveNegativeMark({ negativeMark: 0.25 }), 0.25);
  assert.equal(resolveNegativeMark({ negativeMark: 0 }), 0);
  assert.equal(resolveNegativeMark({ negativeMarkPenalty: 0.25 }), 0.25);
  assert.equal(resolveNegativeMark({ negativeMark: 0, negativeMarkPenalty: 0.25 }), 0);
  assert.equal(resolveNegativeMark({ negativeMark: 0.25, negativeMarkPenalty: 0.5 }), 0.25);
  assert.equal(resolveNegativeMark({}), 0);
});

test('scoring preserves the existing correct, wrong, and unanswered formula', () => {
  assert.equal(scorePattern(10, 0, 0).score, 10);
  assert.equal(scorePattern(6, 2, 2).score, 5.5);
  assert.equal(scorePattern(0, 10, 0).score, -2.5);
  assert.equal(scorePattern(0, 0, 10).score, 0);
  assert.equal(scorePattern(5, 5, 0).score, 3.75);
  assert.equal(scorePattern(5, 0, 5).score, 5);
});

test('evaluation stores each question and rejects invalid, foreign, duplicate, and malformed answers', () => {
  const questions = makeQuestions(3);
  const result = evaluateSubmittedAnswers(
    questions,
    [{ questionId: questions[0]._id, selectedOption: 'A' }],
    1,
    0.25,
    normalizeOptionKey
  );
  assert.equal(result.answers.length, 3);
  assert.equal(result.answers[0].status, 'correct');
  assert.equal(result.answers[1].selectedAnswer, null);
  assert.equal(result.answers[1].correctAnswer, 'A');
  assert.equal(result.answers[1].status, 'unanswered');

  const expectBadAnswers = (answers) => assert.throws(
    () => evaluateSubmittedAnswers(questions, answers, 1, 0.25, normalizeOptionKey),
    (error) => error.statusCode === 400
  );
  expectBadAnswers([{ questionId: 'foreign-id', selectedOption: 'A' }]);
  expectBadAnswers([
    { questionId: questions[0]._id, selectedOption: 'A' },
    { questionId: questions[0]._id, selectedOption: 'B' },
  ]);
  expectBadAnswers([{ questionId: questions[0]._id, selectedOption: 'Z' }]);
  expectBadAnswers([null]);
});
