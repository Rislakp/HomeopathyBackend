const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.MEDIA_PROXY_SECRET = 'test-secret';
const { signResponseImages } = require('../utils/signResponseImages');

const KEY = 'grand_mock_questions/1794894335478-a5e9faf2-Burgundy-and-Gold-Crown-Monogram.png';

function appFor(role, status = 200) {
  const app = express();
  app.use((req, res, next) => { if (role) req.user = { role }; next(); });
  app.use('/api/unani-exams', signResponseImages);
  app.get('/api/unani-exams/x', (req, res) => res.status(status).json({
    success: status < 400,
    data: {
      title: 'Grand mock',
      questions: [
        { questionText: 'Q1', imageUrl: `https://api.whitecoat.academy/uploads/${KEY}`, options: { A: 'a' } },
        { questionText: 'Q2', imageUrl: null },
        { questionText: 'Q3', imageUrl: 'https://example.com/not-ours.png' },
      ],
      student: { profileImage: KEY },
    },
  }));
  return app;
}

function get(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, json: JSON.parse(body) }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('students get signed links for stored question and profile images', async () => {
  const { status, json } = await get(appFor('student'), '/api/unani-exams/x');
  assert.equal(status, 200);
  const [q1, q2, q3] = json.data.questions;
  assert.ok(q1.imageUrl.includes(KEY.split('/')[1]) && /Signature|X-Amz-Signature/.test(q1.imageUrl), q1.imageUrl);
  assert.ok(!q1.imageUrl.includes('/api/media/image'), 'students do not get the admin proxy');
  assert.equal(q2.imageUrl, null);
  assert.equal(q3.imageUrl, 'https://example.com/not-ours.png', 'links that are not ours are unchanged');
  assert.ok(/Signature|X-Amz-Signature/.test(json.data.student.profileImage));
  assert.equal(json.data.questions[0].options.A, 'a');
});

test('the admin panel gets API proxy links', async () => {
  const { json } = await get(appFor('admin'), '/api/unani-exams/x');
  const url = new URL(json.data.questions[0].imageUrl);
  assert.equal(url.pathname, '/api/media/image');
  assert.equal(url.searchParams.get('key'), KEY);
});

test('error responses are passed through untouched', async () => {
  const { status, json } = await get(appFor('student', 404), '/api/unani-exams/x');
  assert.equal(status, 404);
  assert.equal(json.data.questions[0].imageUrl, `https://api.whitecoat.academy/uploads/${KEY}`);
});

test('images in any folder and any field are signed; videos, other text and signed links are not', async () => {
  const { signImagesDeep } = require('../utils/signResponseImages');
  const bucket = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com';
  const body = {
    // A folder no list knows about, in a field no list knows about.
    someNewScreen: { pictureLink: `${bucket}/brand_new_folder/1794977301789-aea2b631-pic.webp` },
    gallery: [`${bucket}/unani_exam_questions/1794977301789-aea2b631-unani_q_1.png`],
    imageUrl: 'student_profiles/1794977301789-aea2b631-me.jpg', // bare key in an image field
    note: 'folder/file.png', // bare key outside an image field: just text
    video: `${bucket}/videos/1794977301789-aea2b631-lesson.mp4`,
    signed: `${bucket}/images/a.png?X-Amz-Signature=abc`,
  };
  for (const viewer of [{ role: 'student' }, { role: 'admin' }, undefined]) {
    const out = await signImagesDeep(body, viewer);
    for (const url of [out.someNewScreen.pictureLink, out.gallery[0], out.imageUrl]) {
      assert.ok(url.startsWith('https://api.whitecoat.academy/api/media/image?key='), `${viewer?.role || 'public'}: ${url}`);
    }
    assert.equal(out.note, body.note);
    assert.equal(out.video, body.video);
    // A signed link may have been saved and expired: it is always signed again.
    assert.notEqual(out.signed, body.signed);
    if (viewer?.role === 'admin') {
      // The admin panel can't load CloudFront/S3 signed links (CORS): the proxy.
      assert.ok(out.signed.startsWith('https://api.whitecoat.academy/api/media/image?key=images%2Fa.png'), out.signed);
    } else {
      assert.ok(out.signed.includes('/images/a.png'), out.signed);
    }
  }
});

test('admin gets the proxy for rank photos a service already signed with CloudFront', async () => {
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  const { signImagesDeep } = require('../utils/signResponseImages');
  const cdn = 'https://media.whitecoat.academy/unani_ranks/1790913540090-620604d8-unani_rank_1.jpg?Expires=1&Signature=abc&Key-Pair-Id=K1';
  const body = { data: [{ name: 'Dr. Amina', profileImage: cdn }] };
  const admin = await signImagesDeep(body, { role: 'superadmin' });
  assert.ok(admin.data[0].profileImage.startsWith('https://api.whitecoat.academy/api/media/image?key=unani_ranks%2F'), admin.data[0].profileImage);
  const student = await signImagesDeep(body, { role: 'student' });
  assert.ok(student.data[0].profileImage.includes('unani_ranks/1790913540090-620604d8-unani_rank_1.jpg'));
  assert.ok(!student.data[0].profileImage.includes('/api/media/image'), 'students do not need the proxy for this folder');
});

test('an expired proxy link saved in the database is signed fresh for every viewer', async () => {
  const { signImagesDeep } = require('../utils/signResponseImages');
  const { verifyImageProxy } = require('../utils/mediaImageProxy');
  const saved = 'https://api.whitecoat.academy/api/media/image?key=unani_exam_questions%2F1794977301789-aea2b631-unani_q_1.png&exp=1&sig=old';
  for (const viewer of [{ role: 'student' }, { role: 'admin' }, undefined]) {
    const out = await signImagesDeep({ questions: [{ imageUrl: saved }] }, viewer);
    const params = Object.fromEntries(new URL(out.questions[0].imageUrl).searchParams);
    assert.equal(params.key, 'unani_exam_questions/1794977301789-aea2b631-unani_q_1.png');
    assert.equal(verifyImageProxy(params.key, params.exp, params.sig), true, 'fresh, valid link');
  }
});

test('signed image links sent back by the admin panel are stored as permanent links', () => {
  const { normalizeImageLinksDeep } = require('../utils/signResponseImages');
  const permanent = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/unani_exam_questions/1794977301789-aea2b631-unani_q_1.png';
  const body = {
    title: 'Q1',
    imageUrl: 'https://api.whitecoat.academy/api/media/image?key=unani_exam_questions%2F1794977301789-aea2b631-unani_q_1.png&exp=1795020886&sig=abc',
    options: [{ image: `${permanent}?X-Amz-Signature=abc&X-Amz-Expires=900` }],
    raw: permanent,
    bareKey: 'unani_exam_questions/1794977301789-aea2b631-unani_q_1.png',
    other: 'https://example.com/pic.png',
    video: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1794977301789-aea2b631-a.mp4?X-Amz-Signature=x',
  };
  const out = normalizeImageLinksDeep(JSON.parse(JSON.stringify(body)));
  assert.equal(out.imageUrl, permanent);
  assert.equal(out.options[0].image, permanent);
  assert.equal(out.raw, permanent);
  assert.equal(out.bareKey, body.bareKey);
  assert.equal(out.other, body.other);
  assert.equal(out.video, body.video);
  assert.equal(out.title, 'Q1');
});
