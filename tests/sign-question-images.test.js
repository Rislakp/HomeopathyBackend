const test = require('node:test');
const assert = require('node:assert/strict');
const { signQuestion, signExamQuestions } = require('../utils/signQuestionImages');

const KEY = 'images/1794890729200-15bba8dd-5340-439c-8f8c-6544f7a2ec81-a.png';
const isSignedFor = (url) => {
  const u = new URL(url);
  return decodeURIComponent(u.pathname).endsWith(`/${KEY}`) && /Signature|X-Amz-Signature/.test(u.search);
};

test('a question image saved as a raw S3, /uploads or key link is returned signed', async () => {
  for (const stored of [
    `https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/${KEY}`,
    `https://api.whitecoat.academy/uploads/${KEY}`,
    `https://white-coat-academy-media.s3.us-east-1.amazonaws.com/${KEY}`,
  ]) {
    const q = await signQuestion({ questionText: 'Q', imageUrl: stored });
    assert.ok(isSignedFor(q.imageUrl), `${stored} -> ${q.imageUrl}`);
    assert.equal(q.image, q.imageUrl);
    assert.equal(q.questionText, 'Q');
  }
});

test('questions without images and mongoose-like documents are handled', async () => {
  const noImage = await signQuestion({ questionText: 'Q', imageUrl: null });
  assert.equal(noImage.imageUrl, null);

  const doc = { toJSON: () => ({ _id: 'e1', title: 'Exam', questions: [{ questionText: 'Q', imageUrl: `https://api.whitecoat.academy/uploads/${KEY}` }] }) };
  const exam = await signExamQuestions(doc);
  assert.equal(exam.title, 'Exam');
  assert.ok(isSignedFor(exam.questions[0].imageUrl));
});
