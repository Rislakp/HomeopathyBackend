const ANSWER_FIELD_NAMES = new Set([
  'answer',
  'answerkey',
  'correctanswer',
  'correctanswertext',
  'correctoption',
  'correctoptiontext',
  'explanation',
  'iscorrect',
  'rationale',
  'solution',
  'solutions',
]);

function sanitizeQuestionForStudent(question) {
  if (!question || typeof question !== 'object') return question;
  const sanitized = {};
  for (const [key, value] of Object.entries(question)) {
    if (ANSWER_FIELD_NAMES.has(key.replace(/[_\s-]/g, '').toLowerCase())) continue;
    sanitized[key] = Array.isArray(value)
      ? value.map(sanitizeQuestionForStudent)
      : (value && typeof value === 'object' ? sanitizeQuestionForStudent(value) : value);
  }
  return sanitized;
}

function resolveNegativeMark(exam) {
  const valid = (value) => value !== null && value !== undefined && value !== '' &&
    Number.isFinite(Number(value)) && Number(value) >= 0;

  // A lean/raw document distinguishes a persisted zero from an absent field.
  if (Object.prototype.hasOwnProperty.call(exam || {}, 'negativeMark') && valid(exam.negativeMark)) {
    return Number(exam.negativeMark);
  }
  if (valid(exam?.negativeMarkPenalty)) return Number(exam.negativeMarkPenalty);
  if (valid(exam?.negativeMarks)) return Number(exam.negativeMarks);
  return 0;
}

function evaluateSubmittedAnswers(questions, answers, marksPerQuestion, negativeMark, normalizeOptionKey) {
  if (!Array.isArray(answers)) {
    const error = new Error('Invalid answers format. Expected an array of answers: [{ questionId, selectedOption }]');
    error.statusCode = 400;
    throw error;
  }

  const questionList = Array.isArray(questions) ? questions : [];
  const questionById = new Map();
  questionList.forEach((question, index) => {
    if (question?._id) questionById.set(String(question._id), { question, index });
  });

  const submittedByIndex = new Map();
  const seenQuestionIds = new Set();
  for (const answer of answers) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      const error = new Error('Each answer must be an object with questionId and selectedOption.');
      error.statusCode = 400;
      throw error;
    }
    if (answer.questionId === undefined || answer.questionId === null || String(answer.questionId).trim() === '') {
      const error = new Error('Each answer must include a valid questionId.');
      error.statusCode = 400;
      throw error;
    }

    const questionId = String(answer.questionId).trim();
    let found = questionById.get(questionId);
    // The current Flutter client uses a zero-based index only when a question
    // has no Mongo subdocument ID. Keep that existing fallback contract.
    if (!found && /^\d+$/.test(questionId)) {
      const index = Number(questionId);
      if (index < questionList.length) found = { question: questionList[index], index };
    }
    if (!found) {
      const error = new Error(`Question ${questionId} does not belong to this exam.`);
      error.statusCode = 400;
      throw error;
    }
    if (seenQuestionIds.has(found.index)) {
      const error = new Error('Duplicate answers for the same question are not allowed.');
      error.statusCode = 400;
      throw error;
    }

    const selectedValue = answer.selectedOption;
    const isEmpty = selectedValue === undefined || selectedValue === null || String(selectedValue).trim() === '';
    const selectedOption = isEmpty ? null : normalizeOptionKey(selectedValue, found.question.options);
    if (!isEmpty && !selectedOption) {
      const error = new Error(`Invalid selectedOption for question ${questionId}.`);
      error.statusCode = 400;
      throw error;
    }

    seenQuestionIds.add(found.index);
    submittedByIndex.set(found.index, selectedOption);
  }

  const marks = Number(marksPerQuestion) || 1;
  const penalty = Number(negativeMark) || 0;
  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let positiveMarks = 0;
  let negativeMarks = 0;

  const processedAnswers = questionList.map((question, index) => {
    const selectedOption = submittedByIndex.get(index) || null;
    const correctOption = normalizeOptionKey(question?.correctOption ?? question?.correctAnswer, question?.options);
    if (!correctOption) {
      const error = new Error(`Question ${index + 1} has no valid correct answer configured.`);
      error.statusCode = 500;
      throw error;
    }

    const isAttempted = selectedOption !== null;
    const isCorrect = isAttempted && selectedOption === correctOption;
    if (isAttempted) {
      totalAttempted += 1;
      if (isCorrect) {
        totalCorrect += 1;
        positiveMarks += marks;
      } else {
        totalWrong += 1;
        negativeMarks += penalty;
      }
    }

    const status = !isAttempted ? 'unanswered' : (isCorrect ? 'correct' : 'wrong');
    return {
      questionId: question?._id || null,
      questionText: question?.questionText || '',
      options: question?.options || {},
      selectedOption,
      selectedAnswer: selectedOption,
      selectedOptionText: selectedOption ? question.options?.[selectedOption] || null : null,
      correctOption,
      correctAnswer: correctOption,
      correctOptionText: question.options?.[correctOption] || null,
      isCorrect,
      status,
    };
  });

  const totalQuestions = questionList.length;
  const maximumScore = totalQuestions * marks;
  const roundedPositiveMarks = Math.round(positiveMarks * 100) / 100;
  const roundedNegativeMarks = Math.round(negativeMarks * 100) / 100;
  const score = Math.round((positiveMarks - negativeMarks) * 100) / 100;
  return {
    answers: processedAnswers,
    totalQuestions,
    totalAttempted,
    totalCorrect,
    totalWrong,
    unansweredQuestions: totalQuestions - totalAttempted,
    positiveMarks: roundedPositiveMarks,
    negativeMarks: roundedNegativeMarks,
    maximumScore,
    totalMarks: maximumScore,
    score,
    percentage: maximumScore > 0 ? Math.round((score / maximumScore) * 10000) / 100 : 0,
  };
}

module.exports = {
  sanitizeQuestionForStudent,
  resolveNegativeMark,
  evaluateSubmittedAnswers,
};
