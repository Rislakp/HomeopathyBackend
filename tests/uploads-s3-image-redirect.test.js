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

test('GET /uploads/<s3 image key> serves the image itself, with CORS, no redirect', async (t) => {
  const s3 = require('../config/s3');
  const asked = [];
  const original = s3.s3Client.send;
  s3.s3Client.send = async (cmd) => {
    asked.push(cmd.input.Key);
    if (cmd.input.Key.includes('missing')) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { ContentType: 'image/png', ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
  };
  t.after(() => { s3.s3Client.send = original; });

  const cors = require('cors');
  const app = express();
  app.use(cors({ origin: 'https://whitecoat.academy' }));
  app.use('/uploads', uploadsS3ImageRedirect);
  app.use((req, res) => res.status(404).end());

  const ok = await get(app, `/uploads/${KEY}`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers.location, undefined, 'no redirect (a cross-site redirect breaks CORS)');
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal(ok.headers['access-control-allow-origin'], 'https://whitecoat.academy');
  assert.deepEqual(asked, [KEY]);

  assert.equal((await get(app, '/uploads/images/1794-missing.png')).statusCode, 404);
  assert.equal((await get(app, '/uploads/videos/1794-a.mp4')).statusCode, 404);
});
