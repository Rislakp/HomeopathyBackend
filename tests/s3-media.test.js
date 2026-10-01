const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config/s3');
const controller = require('../controllers/s3UploadController');
const Course = require('../models/Course');
const Student = require('../models/Student');
const defaultCredentialProvider = config.s3Client.config.credentials;
// Synthetic, in-memory credentials are scoped to this test process only.
config.s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'local-test-only-secret' });
process.on('exit', () => { config.s3Client.config.credentials = defaultCredentialProvider; });

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const call = async (handler, body = {}, user = { id: 'admin-test', role: 'admin' }) => {
  const res = makeResponse();
  await handler({ body, user }, res);
  return res;
};

test('S3 configuration, controller exports, and route callbacks load', async (t) => {
  assert.equal(config.region, 'us-east-1');
  assert.equal(config.bucket, 'whitecoat-media-prod');
  const courseWithS3Media = new Course({
    courseTitle: 'S3 media schema check', instructor: 'Test', price: 0,
    thumbnailMedia: { storageProvider: 's3', s3Key: 'images/test.png', title: 'test.png', contentType: 'image/png', fileSize: 512, uploadStatus: 'uploaded' },
    modules: [{ moduleName: 'Module', lessons: [{
      lessonTitle: 'Lesson',
      videoParts: [{ storageProvider: 's3', s3Key: 'videos/test.mp4', title: 'test.mp4', contentType: 'video/mp4', fileSize: 512, uploadStatus: 'uploaded' }],
      pdfNotes: [{ storageProvider: 's3', s3Key: 'pdfs/test.pdf', title: 'test.pdf', contentType: 'application/pdf', fileSize: 512, uploadStatus: 'uploaded' }],
    }] }],
  });
  assert.equal(courseWithS3Media.validateSync(), undefined, 'existing course model must accept S3 media metadata');
  for (const name of ['initiateMultipartUpload', 'partUrl', 'completeMultipartUpload', 'abortMultipartUpload']) {
    assert.equal(typeof controller[name], 'function', `${name} must be exported`);
  }
  const router = require('../routes/s3UploadRoutes');
  for (const path of ['/multipart/initiate', '/multipart/part-url', '/multipart/complete', '/multipart/abort', '/objects/presign', '/objects/complete', '/media/access-url']) {
    const layer = router.stack.find((item) => item.route && item.route.path === path);
    assert.ok(layer, `missing route ${path}`);
    assert.ok(layer.route.stack.every((routeHandler) => typeof routeHandler.handle === 'function'));
  }
});

test('multipart initiate, part URL, complete, and abort use the expected S3 commands', async (t) => {
  const originalSend = config.s3Client.send;
  const calls = [];
  config.s3Client.send = async (command) => {
    calls.push(command);
    if (command.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'upload-test' };
    if (command.constructor.name === 'CompleteMultipartUploadCommand') return { Location: 's3://private/test', ETag: '"complete-etag"' };
    if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 6000000, ContentType: 'video/mp4' };
    return {};
  };
  t.after(() => { config.s3Client.send = originalSend; });

  const initiated = await call(controller.initiateMultipartUpload, { fileName: 'lesson.mp4', contentType: 'video/mp4', fileSize: 6000000 });
  assert.equal(initiated.statusCode, 201);
  assert.equal(calls[0].input.ACL, undefined, 'uploads must not grant public ACL access');
  assert.equal(initiated.body.uploadId, 'upload-test');
  assert.match(initiated.body.key, /^videos\//);

  const partUrl = await call(controller.partUrl, { uploadId: 'upload-test', key: initiated.body.key, partNumber: 1 });
  assert.equal(partUrl.statusCode, 200);
  assert.match(partUrl.body.url, /partNumber=1/);

  const completed = await call(controller.completeMultipartUpload, {
    uploadId: 'upload-test', key: initiated.body.key, fileName: 'lesson.mp4', contentType: 'video/mp4', fileSize: 6000000,
    parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.media.s3Key, initiated.body.key);
  assert.equal(completed.body.media.uploadStatus, 'uploaded');

  const aborted = await call(controller.abortMultipartUpload, { uploadId: 'upload-test', key: initiated.body.key });
  assert.equal(aborted.statusCode, 200);
  assert.deepEqual(calls.map((command) => command.constructor.name), [
    'CreateMultipartUploadCommand',
    'CompleteMultipartUploadCommand',
    'HeadObjectCommand',
    'AbortMultipartUploadCommand',
  ]);
});

test('image and PDF presigning validate inputs and verify uploaded metadata', async (t) => {
  const originalSend = config.s3Client.send;
  let headResult = { ContentLength: 512, ContentType: 'image/png' };
  config.s3Client.send = async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') return headResult;
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  t.after(() => { config.s3Client.send = originalSend; });

  const badType = await call(controller.initiateObjectUpload, { mediaType: 'image', fileName: 'x.png', contentType: 'application/pdf', fileSize: 512 });
  assert.equal(badType.statusCode, 400);
  const tooLarge = await call(controller.initiateObjectUpload, { mediaType: 'pdf', fileName: 'x.pdf', contentType: 'application/pdf', fileSize: 300 * 1024 * 1024 });
  assert.equal(tooLarge.statusCode, 400);

  const image = await call(controller.initiateObjectUpload, { mediaType: 'image', fileName: 'lesson.png', contentType: 'image/png', fileSize: 512 });
  assert.equal(image.statusCode, 201);
  assert.match(image.body.key, /^images\//);
  assert.match(image.body.url, /X-Amz-Signature=/);
  const imageVerified = await call(controller.completeObjectUpload, { mediaType: 'image', key: image.body.key, fileName: 'lesson.png', contentType: 'image/png', fileSize: 512 });
  assert.equal(imageVerified.body.media.uploadStatus, 'uploaded');

  const pdf = await call(controller.initiateObjectUpload, { mediaType: 'pdf', fileName: 'notes.pdf', contentType: 'application/pdf', fileSize: 512 });
  assert.equal(pdf.statusCode, 201);
  assert.match(pdf.body.key, /^pdfs\//);
  headResult = { ContentLength: 512, ContentType: 'application/pdf' };
  const pdfVerified = await call(controller.completeObjectUpload, { mediaType: 'pdf', key: pdf.body.key, fileName: 'notes.pdf', contentType: 'application/pdf', fileSize: 512 });
  assert.equal(pdfVerified.body.media.uploadStatus, 'uploaded');
  headResult = { ContentLength: 513, ContentType: 'application/pdf' };
  const mismatch = await call(controller.completeObjectUpload, { mediaType: 'pdf', key: pdf.body.key, fileName: 'notes.pdf', contentType: 'application/pdf', fileSize: 512 });
  assert.equal(mismatch.statusCode, 400);
  const missing = await call(controller.initiateObjectUpload, { mediaType: 'image', contentType: 'image/png', fileSize: 10 });
  assert.equal(missing.statusCode, 400);
});

test('private media access requires the key to be referenced by an authorized course', async (t) => {
  const originalFindById = Course.findById;
  const originalFindOne = Course.findOne;
  const originalStudentFindOne = Student.findOne;
  const originalSend = config.s3Client.send;
  Course.findById = async () => null;
  Course.findOne = async () => ({
    _id: 'course-db-id', courseId: 'CRS-123',
    modules: [{ lessons: [{ pdfNotes: [{ storageProvider: 's3', s3Key: 'pdfs/stored-notes.pdf' }] }] }],
  });
  config.s3Client.send = async () => ({});
  t.after(() => {
    Course.findById = originalFindById;
    Course.findOne = originalFindOne;
    Student.findOne = originalStudentFindOne;
    config.s3Client.send = originalSend;
  });

  const denied = await call(controller.getMediaAccessUrl, { courseId: 'CRS-123', key: 'pdfs/not-attached.pdf' });
  assert.equal(denied.statusCode, 404);
  Student.findOne = async () => null;
  const unauthorized = await call(controller.getMediaAccessUrl, { courseId: 'CRS-123', key: 'pdfs/stored-notes.pdf' }, { id: 'student-test', email: 'learner@example.test', role: 'student' });
  assert.equal(unauthorized.statusCode, 403);
  Student.findOne = async () => ({ courseId: 'CRS-123', status: 'Active', subscriptionStatus: 'Active', email: 'learner@example.test' });
  const studentAccess = await call(controller.getMediaAccessUrl, { courseId: 'CRS-123', key: 'pdfs/stored-notes.pdf' }, { id: 'student-test', email: 'learner@example.test', role: 'student' });
  assert.equal(studentAccess.statusCode, 200);
  const allowed = await call(controller.getMediaAccessUrl, { courseId: 'CRS-123', key: 'pdfs/stored-notes.pdf' });
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.body.url, /X-Amz-Signature=/);
});

test('multipart S3 failures become safe client errors', async (t) => {
  const originalSend = config.s3Client.send;
  config.s3Client.send = async () => {
    const error = new Error('not found');
    error.name = 'NoSuchUpload';
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  };
  t.after(() => { config.s3Client.send = originalSend; });
  const failed = await call(controller.abortMultipartUpload, { uploadId: 'missing-upload', key: 'videos/1790796864035-lesson.mp4' });
  assert.equal(failed.statusCode, 404);
  assert.equal(failed.body.message, 'Multipart upload was not found.');
});
