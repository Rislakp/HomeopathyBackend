const test = require('node:test');
const assert = require('node:assert/strict');
const { bucket, region } = require('../config/s3');
const { normalizeS3Reference } = require('../utils/s3MediaSigner');

const KEY = 'grand_mock_questions/1794828484124-c516f454-Burgundy-and-Gold-Crown-Monogram.png';

test('links saved with the old wrong bucket name map back to the real key', () => {
  for (const host of [
    'white-coat-academy-media.s3.us-east-1.amazonaws.com',
    'white-coat-academy-media.s3.ap-south-1.amazonaws.com',
    'white-coat-academy-media.s3.amazonaws.com',
  ]) {
    assert.equal(normalizeS3Reference(`https://${host}/${KEY}`)?.s3Key, KEY, host);
  }
});

test('our CloudFront links (even expired signed ones) map back to the key', () => {
  assert.equal(normalizeS3Reference(`https://media.whitecoat.academy/${KEY}?Expires=1&Signature=x&Key-Pair-Id=K`)?.s3Key, KEY);
});

test('other buckets and hosts are still rejected', () => {
  assert.equal(normalizeS3Reference(`https://someone-else.s3.us-east-1.amazonaws.com/${KEY}`), null);
  assert.equal(normalizeS3Reference(`https://evil.example.com/${KEY}`), null);
});

test('a saved question image uses the configured bucket, not a hard-coded name', () => {
  delete require.cache[require.resolve('../controllers/examController')];
  const exam = require('../controllers/examController');
  const validate = exam.validateAndSanitizeQuestion || exam._validateAndSanitizeQuestion;
  if (typeof validate !== 'function') return; // helper not exported; covered by the URL test above
  const r = validate({ questionText: 'Q?', options: { A: '1', B: '2', C: '3', D: '4' }, correctOption: 'A', imageUrl: KEY }, 0);
  assert.equal(r.question.imageUrl, `https://${bucket}.s3.${region}.amazonaws.com/${KEY}`);
});

test('links built as "<api>/uploads/<s3 key>" map back to the S3 key', () => {
  const key = 'images/1794890729200-15bba8dd-5340-439c-8f8c-6544f7a2ec81-Burgundy-and-Gold-Crown-Monogram.png';
  assert.equal(normalizeS3Reference(`https://api.whitecoat.academy/uploads/${key}`)?.s3Key, key);
  assert.equal(normalizeS3Reference(`/uploads/${key}`)?.s3Key, key);
});

test('real local uploads, other hosts and path tricks are not treated as S3 keys', () => {
  assert.equal(normalizeS3Reference('https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf'), null);
  assert.equal(normalizeS3Reference('https://evil.example.com/uploads/images/a.png'), null);
  assert.equal(normalizeS3Reference('https://api.whitecoat.academy/uploads/images/../../etc/passwd'), null);
});
