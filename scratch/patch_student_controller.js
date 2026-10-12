const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../src/student/student.controller.js');
let s = fs.readFileSync(targetFile, 'utf8');

// Normalize line endings to \r\n for matching
const hasCRLF = s.includes('\r\n');
if (hasCRLF) s = s.replace(/\r\n/g, '\n');

// 1. Add import
if (!s.includes('resolveProfileImageUrl')) {
  s = s.replace(
    "try { require('../../models/Course'); } catch (e) {}",
    "const { resolveProfileImageUrl } = require('../../utils/s3MediaSigner');\ntry { require('../../models/Course'); } catch (e) {}"
  );
}

// 2. Update formatQuestionWithAnswerKey
const oldFmt = `function formatQuestionWithAnswerKey(question) {
  const correctOption = getQuestionCorrectOption(question);
  const correctOptionText = question && question.options && correctOption
    ? (question.options[correctOption] || null)
    : null;

  return {
    ...question,
    correctOption,
    correctAnswer: correctOption,
    correctOptionText,
    correctAnswerText: correctOptionText
  };
}`;

const newFmt = `async function formatQuestionWithAnswerKey(question) {
  const correctOption = getQuestionCorrectOption(question);
  const correctOptionText = question && question.options && correctOption
    ? (question.options[correctOption] || null)
    : null;

  const rawImg = question?.imageUrl || question?.image || question?.questionImage || question?.imgUrl;
  let resolvedImageUrl = rawImg || null;
  if (typeof rawImg === 'string' && rawImg.trim()) {
    resolvedImageUrl = await resolveProfileImageUrl(rawImg.trim());
  }

  return {
    ...question,
    imageUrl: resolvedImageUrl,
    image: resolvedImageUrl,
    correctOption,
    correctAnswer: correctOption,
    correctOptionText,
    correctAnswerText: correctOptionText
  };
}`;

s = s.replace(oldFmt, newFmt);

// 3. Update startExam questions mapping
const oldStartExam = `    // Sanitize questions to prevent cheating - completely remove \`correctOption\`
    const sanitizedQuestions = (exam.questions || []).map(sanitizeQuestionForStudent);`;

const newStartExam = `    // Sanitize questions to prevent cheating - completely remove \`correctOption\` and resolve image presigned URLs
    const sanitizedQuestions = await Promise.all((exam.questions || []).map(async (q) => {
      const sanitized = sanitizeQuestionForStudent(q);
      const rawImg = sanitized.imageUrl || sanitized.image || sanitized.questionImage || sanitized.imgUrl;
      if (typeof rawImg === 'string' && rawImg.trim()) {
        const signed = await resolveProfileImageUrl(rawImg.trim());
        sanitized.imageUrl = signed;
        sanitized.image = signed;
      }
      return sanitized;
    }));`;

s = s.replace(oldStartExam, newStartExam);

// 4. Update submitExam examInfo questions mapping
const oldSubmitQuestions = `        examInfo: {
          ...exam,
          questions: exam.questions.map(formatQuestionWithAnswerKey)
        },`;

const newSubmitQuestions = `        examInfo: {
          ...exam,
          questions: await Promise.all(exam.questions.map(formatQuestionWithAnswerKey))
        },`;

s = s.replace(oldSubmitQuestions, newSubmitQuestions);

// 5. Update getStudentResults exam questions mapping
const oldResultQuestions = `        const formattedQuestions = (exam.questions || []).map(formatQuestionWithAnswerKey);`;
const newResultQuestions = `        const formattedQuestions = await Promise.all((exam.questions || []).map(formatQuestionWithAnswerKey));`;
s = s.replace(oldResultQuestions, newResultQuestions);

s = s.replace(
  'const formattedResults = validResults.map((result) => {',
  'const formattedResults = await Promise.all(validResults.map(async (result) => {'
);

s = s.replace(
  '      return {\n        ...result,\n        examId: examMetadata,\n        answers: formattedAnswers\n      };\n    });',
  '      return {\n        ...result,\n        examId: examMetadata,\n        answers: formattedAnswers\n      };\n    }));'
);

if (hasCRLF) s = s.replace(/\n/g, '\r\n');

fs.writeFileSync(targetFile, s, 'utf8');
console.log('Successfully updated src/student/student.controller.js');
