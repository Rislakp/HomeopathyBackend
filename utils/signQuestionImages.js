/**
 * Exam question images are stored as S3 keys/links. Before sending a question
 * (or an exam with questions) to the browser, replace the image with a fresh
 * signed link, the same way exam start and exam detail already do.
 */
const { signImageForViewer } = require('./mediaImageProxy');

// Same shape the response would have had (mongoose documents -> plain JSON).
const toPlain = (value) => (value && typeof value.toJSON === 'function' ? value.toJSON() : value);

// viewer: req.user. Students get CloudFront links; the admin panel gets API proxy links.
async function signQuestion(question, viewer) {
  const plain = toPlain(question);
  if (!plain || typeof plain !== 'object') return plain;
  const out = { ...plain };
  const raw = out.imageUrl || out.image || out.questionImage || out.imgUrl;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const signed = await signImageForViewer(raw.trim(), viewer);
      out.imageUrl = signed;
      out.image = signed;
      out.questionImage = signed;
    } catch (_) { /* keep the stored value */ }
  }
  return out;
}

async function signExamQuestions(exam, viewer) {
  const plain = toPlain(exam);
  if (!plain || typeof plain !== 'object' || !Array.isArray(plain.questions)) return plain;
  return { ...plain, questions: await Promise.all(plain.questions.map((q) => signQuestion(q, viewer))) };
}

module.exports = { signQuestion, signExamQuestions };
