const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const s3 = require('../config/s3');

const RAW = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/unani_exam_questions/1794977301789-aea2b631-unani_q_1.png';

async function withFakeS3(t) {
  const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#3366cc' } }).png().toBuffer();
  const asked = [];
  const original = s3.s3Client.send;
  s3.s3Client.send = async (cmd) => {
    asked.push(cmd.input.Key);
    if (cmd.input.Key.includes('missing')) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { ContentLength: png.length, Body: { transformToByteArray: async () => new Uint8Array(png) } };
  };
  t.after(() => { s3.s3Client.send = original; });
  return asked;
}

const exam = (imageUrl) => ({
  title: 'Unani Grand Mock',
  questions: [
    { _id: 'q1', questionText: 'Which planet is red?', imageUrl, options: { A: 'Venus', B: 'Mars', C: 'Jupiter', D: 'Saturn' }, correctOption: 'B' },
    { _id: 'q2', questionText: 'No image here', options: { A: '1', B: '2', C: '3', D: '4' }, correctOption: 'A' },
  ],
});

const imageCount = (pdf) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

test('Unani answer key PDF draws the question image instead of its link', async (t) => {
  const asked = await withFakeS3(t);
  const service = require('../src/unani/exams/services/unaniExam.service');
  const pdf = await service.generateUnaniAnswerKeyPDF(exam(RAW), { name: 'Student' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(asked, ['unani_exam_questions/1794977301789-aea2b631-unani_q_1.png']);
  assert.ok(imageCount(pdf) >= 1, 'PDF contains an image');
});

test('Homeopathy answer key PDF draws question images too', async (t) => {
  await withFakeS3(t);
  const { generateWatermarkedAnswerKeyPDF } = require('../src/student/answerKey.controller');
  const before = imageCount(await generateWatermarkedAnswerKeyPDF(exam(null), { name: 'Student' }));
  const pdf = await generateWatermarkedAnswerKeyPDF(exam(RAW.replace('unani_exam_questions', 'grand_mock_questions')), { name: 'Student' });
  assert.ok(imageCount(pdf) > before, 'one more image than without a question image');
});

test('answer key PDF draws images saved as (expired) proxy links', async (t) => {
  const asked = await withFakeS3(t);
  const service = require('../src/unani/exams/services/unaniExam.service');
  const saved = 'https://api.whitecoat.academy/api/media/image?key=unani_exam_questions%2F1794977301789-aea2b631-unani_q_1.png&exp=1&sig=old';
  const pdf = await service.generateUnaniAnswerKeyPDF(exam(saved), { name: 'Student' });
  assert.deepEqual(asked, ['unani_exam_questions/1794977301789-aea2b631-unani_q_1.png']);
  assert.ok(imageCount(pdf) >= 1);
});

test('a missing image does not break the PDF', async (t) => {
  await withFakeS3(t);
  const service = require('../src/unani/exams/services/unaniExam.service');
  const pdf = await service.generateUnaniAnswerKeyPDF(exam(RAW.replace('unani_q_1', 'missing')), { name: 'Student' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
