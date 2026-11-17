const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { uploadsS3ImageRedirect, imageKeyFromPath } = require('../middleware/uploadsS3ImageRedirect');

const KEY = 'images/1794890729200-15bba8dd-5340-439c-8f8c-6544f7a2ec81-Burgundy-and-Gold-Crown-Monogram.png';

test('only image keys in image folders are recognised', () => {
  assert.deepEqual(imageKeyFromPath(`/${KEY}`), { key: KEY, contentType: 'image/png' });
  assert.equal(imageKeyFromPath('/grand_mock_questions/1794-a.jpg').contentType, 'image/jpeg');
  assert.equal(imageKeyFromPath('/videos/1794-a.mp4'), null, 'videos are not redirected');
  assert.equal(imageKeyFromPath('/pdfs/1794-a.pdf'), null, 'documents are not redirected');
  assert.equal(imageKeyFromPath('/images/../../etc/passwd.png'), null);
  assert.equal(imageKeyFromPath('/SAMPLE QUESTION.png'), null, 'local uploads are left to static files');
});

function get(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path }, (res) => {
        res.resume();
        res.on('end', () => { server.close(); resolve(res); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('GET /uploads/<s3 image key> redirects to a signed link for that key', async () => {
  const app = express();
  app.use('/uploads', uploadsS3ImageRedirect);
  app.use((req, res) => res.status(404).end());

  const ok = await get(app, `/uploads/${KEY}`);
  assert.equal(ok.statusCode, 302);
  // CloudFront in production; a presigned S3 link where CloudFront keys are not set (tests).
  const loc = new URL(ok.headers.location);
  assert.ok(decodeURIComponent(loc.pathname).endsWith(`/${KEY}`), ok.headers.location);
  assert.ok(/Signature|X-Amz-Signature/.test(loc.search), 'link is signed');
  assert.equal(ok.headers['cache-control'], 'no-store');

  const video = await get(app, '/uploads/videos/1794-a.mp4');
  assert.equal(video.statusCode, 404);
});
