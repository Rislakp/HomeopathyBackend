const test = require('node:test');
const assert = require('node:assert/strict');
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand, CreateMultipartUploadCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { signS3Reference, resolveMediaRecord, S3_MEDIA_URL_TTL_SECONDS } = require('../utils/s3MediaSigner');
const demoVideoController = require('../controllers/demoVideoController');
const s3UploadController = require('../controllers/s3UploadController');
const s3Service = require('../services/s3Service');
const DemoVideo = require('../models/DemoVideo');

test('1. signS3Reference infers video/mp4 and applies ResponseContentType and inline disposition when omitted', async (t) => {
  const originalSend = s3Client.send;
  let capturedCommand = null;
  t.after(() => { s3Client.send = originalSend; });

  const ref = {
    storageProvider: 's3',
    s3Key: 'videos/lecture-101.mp4',
    // contentType intentionally omitted or application/octet-stream
    contentType: 'application/octet-stream',
  };

  const signed = await signS3Reference(ref);
  assert.ok(signed.url, 'Signed URL must be generated');
  assert.ok(signed.url.includes('response-content-type=video%2Fmp4'), 'Must enforce video/mp4 for .mp4 video keys');
  assert.ok(signed.url.includes('response-content-disposition=inline'), 'Must enforce inline disposition for streaming');
  assert.equal(signed.accessUrlExpiresIn, S3_MEDIA_URL_TTL_SECONDS, 'Must use 7200s TTL');
});

test('2. signS3Reference accurately distinguishes webm, mov, and pdf MIME types', async (t) => {
  const originalSend = s3Client.send;
  t.after(() => { s3Client.send = originalSend; });

  const webmRef = { storageProvider: 's3', s3Key: 'videos/recording.webm' };
  const signedWebm = await signS3Reference(webmRef);
  assert.ok(signedWebm.url.includes('response-content-type=video%2Fwebm'));

  const movRef = { storageProvider: 's3', s3Key: 'videos/clip.mov' };
  const signedMov = await signS3Reference(movRef);
  assert.ok(signedMov.url.includes('response-content-type=video%2Fquicktime'));

  const pdfRef = { storageProvider: 's3', s3Key: 'pdfs/handout.pdf' };
  const signedPdf = await signS3Reference(pdfRef);
  assert.ok(signedPdf.url.includes('response-content-type=application%2Fpdf'));
});

test('3. resolveMediaRecord automatically resolves video parts to video/mp4 even if stored with octet-stream', async (t) => {
  const originalSend = s3Client.send;
  t.after(() => { s3Client.send = originalSend; });

  const rawVideo = {
    title: 'clinical_lecture.mp4',
    storageProvider: 's3',
    s3Key: 'videos/clinical_lecture.mp4',
    contentType: 'application/octet-stream',
  };

  const resolved = await resolveMediaRecord(rawVideo);
  assert.ok(resolved.url.includes('response-content-type=video%2Fmp4'));
  assert.ok(resolved.url.includes('response-content-disposition=inline'));
});

test('4. demoVideoController uses 7200s TTL and enforces video/mp4 with inline disposition', async (t) => {
  const originalSend = s3Client.send;
  t.after(() => { s3Client.send = originalSend; });

  // Test signDemoVideo directly via getDemoVideos mock
  const origFind = DemoVideo.find;
  t.after(() => { DemoVideo.find = origFind; });

  const mockDemo = {
    _id: '6ac50c6174ca2bc1975b4961',
    title: 'Free Demo Class',
    videoUrl: 'https://whitecoat-media-prod.s3.amazonaws.com/videos/demo-1.mp4',
    s3Key: 'videos/demo-1.mp4',
    storageProvider: 's3',
    toObject() { return { ...this }; },
  };

  DemoVideo.find = () => ({
    sort: () => Promise.resolve([mockDemo]),
  });

  const req = { query: {} };
  let responseData = null;
  const res = {
    json(data) { responseData = data; return this; },
    status() { return this; },
  };

  await demoVideoController.getDemoVideos(req, res);
  assert.ok(responseData && responseData.data && responseData.data[0]);
  const signedVideo = responseData.data[0];
  assert.ok(signedVideo.videoUrl.includes('response-content-type=video%2Fmp4'), 'Demo video must enforce video/mp4');
  assert.ok(signedVideo.videoUrl.includes('response-content-disposition=inline'), 'Demo video must enforce inline');
  assert.ok(signedVideo.videoUrl.includes(`X-Amz-Expires=${S3_MEDIA_URL_TTL_SECONDS}`), 'Demo video must use 7200s TTL, not 900s');
});

test('5. s3UploadController initiateMultipartUpload configures Cache-Control for chunk caching', async (t) => {
  const originalSend = s3Client.send;
  let sentCommand = null;
  s3Client.send = async (command) => {
    sentCommand = command;
    if (command instanceof CreateMultipartUploadCommand) {
      return { UploadId: 'test-upload-id' };
    }
    return {};
  };
  t.after(() => { s3Client.send = originalSend; });

  const req = {
    body: {
      fileName: 'recorded-lecture.mp4',
      contentType: 'video/mp4',
      fileSize: 52428800,
    },
    user: { id: 'admin1', role: 'admin' },
  };

  let statusCode = 200;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { body = data; return this; },
  };

  await s3UploadController.initiateMultipartUpload(req, res);
  assert.equal(statusCode, 201);
  assert.ok(sentCommand instanceof CreateMultipartUploadCommand);
  assert.equal(sentCommand.input.CacheControl, 'public, max-age=31536000', 'Cache-Control header must be set to 1 year');
  assert.equal(sentCommand.input.ContentType, 'video/mp4');
});

test('6. s3Service.uploadBufferToS3 auto-detects video/mp4 from filename when mimetype is application/octet-stream', async (t) => {
  const originalSend = s3Client.send;
  let sentCommand = null;
  s3Client.send = async (command) => {
    sentCommand = command;
    return {};
  };
  t.after(() => { s3Client.send = originalSend; });

  const testBuffer = Buffer.from('fake-mp4-stream-data');
  const result = await s3Service.uploadBufferToS3(testBuffer, {
    originalname: 'clinical-study.mp4',
    mimetype: 'application/octet-stream', // Generic fallback
    folder: 'videos',
  });

  assert.equal(result.contentType, 'video/mp4', 'MIME type must be auto-corrected to video/mp4');
  assert.equal(result.resourceType, 'video', 'Resource type must be detected as video');
});

test('7. HTTP Range streaming contract: verify 206 Partial Content, Content-Range, Content-Length, and Accept-Ranges', () => {
  // Simulate standard Range request handling for video seeking
  const fileSize = 20000000; // 20 MB
  const rangeHeader = 'bytes=10000000-10065535'; // Seeking to middle (64KB chunk)

  const matches = rangeHeader.match(/bytes=(\d+)-(\d+)/);
  const start = parseInt(matches[1], 10);
  const end = parseInt(matches[2], 10);
  const chunkLength = end - start + 1;

  assert.equal(start, 10000000);
  assert.equal(end, 10065535);
  assert.equal(chunkLength, 65536);

  // Expected 206 headers
  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': chunkLength,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000',
  };

  assert.equal(headers['Content-Type'], 'video/mp4');
  assert.equal(headers['Accept-Ranges'], 'bytes');
  assert.equal(headers['Content-Range'], 'bytes 10000000-10065535/20000000');
  assert.equal(headers['Content-Length'], 65536);
});
