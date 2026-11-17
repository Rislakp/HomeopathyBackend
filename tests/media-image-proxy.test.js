const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const express = require('express');
const s3 = require('../config/s3');

process.env.MEDIA_PROXY_SECRET = 'test-secret';
const proxy = require('../utils/mediaImageProxy');

const KEY = 'grand_mock_questions/1794894335478-a5e9faf2-Burgundy-and-Gold-Crown-Monogram.png';
const params = (url) => Object.fromEntries(new URL(url).searchParams);

test('signed proxy link verifies, and rejects tampering, expiry and non-image keys', () => {
  const url = proxy.buildImageProxyUrl(KEY);
  assert.ok(url.startsWith('https://api.whitecoat.academy/api/media/image?'));
  const { key, exp, sig } = params(url);
  assert.equal(key, KEY);
  assert.equal(proxy.verifyImageProxy(key, exp, sig), true);
  assert.equal(proxy.verifyImageProxy('grand_mock_questions/other.png', exp, sig), false, 'other key');
  assert.equal(proxy.verifyImageProxy(key, String(Number(exp) + 1), sig), false, 'changed expiry');
  assert.equal(proxy.verifyImageProxy(key, exp, sig, { now: (Number(exp) + 1) * 1000 }), false, 'expired');
  assert.equal(proxy.buildImageProxyUrl('videos/1794-a.mp4'), '', 'videos are never proxied');
});

test('students get CloudFront/S3 links; admin viewers get the API proxy', async () => {
  const stored = `https://api.whitecoat.academy/uploads/${KEY}`;
  const forStudent = await proxy.signImageForViewer(stored, { role: 'student' });
  assert.ok(!forStudent.includes('/api/media/image'), forStudent);
  const forAdmin = await proxy.signImageForViewer(stored, { role: 'admin' });
  assert.ok(forAdmin.includes('/api/media/image?'), forAdmin);
  assert.equal(params(forAdmin).key, KEY);
});

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { server.close(); resolve({ res, body: Buffer.concat(chunks) }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('GET /api/media/image streams the image for a valid link and refuses a bad one', async (t) => {
  t.mock.method(s3.s3Client, 'send', async (cmd) => {
    assert.equal(cmd.input.Key, KEY);
    return { ContentType: 'image/png', ContentLength: 4, Body: Readable.from([Buffer.from('PNG!')]) };
  });
  const app = express();
  app.get('/api/media/image', proxy.imageProxyHandler);

  const url = new URL(proxy.buildImageProxyUrl(KEY));
  const ok = await request(app, url.pathname + url.search);
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.res.headers['content-type'], 'image/png');
  assert.equal(ok.body.toString(), 'PNG!');

  const bad = await request(app, `/api/media/image?key=${encodeURIComponent(KEY)}&exp=9999999999&sig=wrong`);
  assert.equal(bad.res.statusCode, 403);
});
