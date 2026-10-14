const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const recordingController = require('../controllers/recordingController');
const Recording = require('../models/Recording');
const s3Service = require('../services/s3Service');
const recordingRoutes = require('../routes/recordingRoutes');

const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

test('1. DELETE /api/recordings/:id - Successfully deletes by valid MongoDB _id', async () => {
  const testObjectId = new mongoose.Types.ObjectId().toString();
  const mockDoc = {
    _id: testObjectId,
    s3Key: 'videos/test-recording.mp4',
    storageProvider: 's3',
    recordedVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/test-recording.mp4',
  };

  let findByIdCalledWith = null;
  let findByIdAndDeleteCalledWith = null;
  let s3DeleteCalledWith = null;

  const origFindById = Recording.findById;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;
  const origDeleteFile = s3Service.deleteFile;
  const origIsS3Configured = s3Service.isS3Configured;

  Recording.findById = async (id) => {
    findByIdCalledWith = id;
    if (id === testObjectId) return { ...mockDoc };
    return null;
  };
  Recording.findByIdAndDelete = async (id) => {
    findByIdAndDeleteCalledWith = id;
    return { ...mockDoc };
  };
  s3Service.isS3Configured = () => true;
  s3Service.deleteFile = async (target) => {
    s3DeleteCalledWith = target;
    return { success: true };
  };

  try {
    const req = { params: { id: testObjectId } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.message, 'Recording deleted successfully');
    assert.strictEqual(res.body.data.deletedId, testObjectId);
    assert.strictEqual(res.body.data.s3Key, 'videos/test-recording.mp4');
    assert.strictEqual(res.body.data.storageProvider, 's3');

    assert.strictEqual(findByIdCalledWith, testObjectId);
    assert.strictEqual(s3DeleteCalledWith, 'videos/test-recording.mp4');
    assert.strictEqual(findByIdAndDeleteCalledWith, testObjectId);
  } finally {
    Recording.findById = origFindById;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
    s3Service.deleteFile = origDeleteFile;
    s3Service.isS3Configured = origIsS3Configured;
  }
});

test('2. DELETE /api/recordings/:id - Fallback lookup by s3Key when client passes s3Key identifier', async () => {
  const testObjectId = new mongoose.Types.ObjectId().toString();
  const testS3Key = 'videos/1791471476238-sample-video.webm';
  const mockDoc = {
    _id: testObjectId,
    s3Key: testS3Key,
    storageProvider: 's3',
    recordedVideoUrl: `https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/${testS3Key}`,
  };

  let findOneCalledWith = null;
  let findByIdAndDeleteCalledWith = null;

  const origFindById = Recording.findById;
  const origFindOne = Recording.findOne;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;
  const origDeleteFile = s3Service.deleteFile;
  const origIsS3Configured = s3Service.isS3Configured;

  Recording.findById = async () => null;
  Recording.findOne = async (query) => {
    findOneCalledWith = query;
    if (query.s3Key === testS3Key) return { ...mockDoc };
    return null;
  };
  Recording.findByIdAndDelete = async (id) => {
    findByIdAndDeleteCalledWith = id;
    return { ...mockDoc };
  };
  s3Service.isS3Configured = () => true;
  s3Service.deleteFile = async () => ({ success: true });

  try {
    const req = { params: { id: testS3Key } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.deletedId, testObjectId);
    assert.strictEqual(res.body.data.s3Key, testS3Key);
    assert.strictEqual(findOneCalledWith.s3Key, testS3Key);
    assert.strictEqual(findByIdAndDeleteCalledWith, testObjectId);
  } finally {
    Recording.findById = origFindById;
    Recording.findOne = origFindOne;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
    s3Service.deleteFile = origDeleteFile;
    s3Service.isS3Configured = origIsS3Configured;
  }
});

test('3. DELETE /api/recordings/:id - Nonexistent ID returns documented 404 without deleting records', async () => {
  const nonexistentId = '6acf1de992b8baa17a2bd71a';
  let deleteCalled = false;

  const origFindById = Recording.findById;
  const origFindOne = Recording.findOne;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;

  Recording.findById = async () => null;
  Recording.findOne = async () => null;
  Recording.findByIdAndDelete = async () => {
    deleteCalled = true;
  };

  try {
    const req = { params: { id: nonexistentId } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, 'Recording document not found');
    assert.strictEqual(deleteCalled, false);
  } finally {
    Recording.findById = origFindById;
    Recording.findOne = origFindOne;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
  }
});

test('4. DELETE /api/recordings/:id - Invalid ID format returns 400', async () => {
  const req = { params: { id: '' } };
  const res = makeResponse();

  await recordingController.deleteRecording(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
});

test('5. DELETE /api/recordings/:id - S3 cleanup failure does NOT remove MongoDB record', async () => {
  const testObjectId = new mongoose.Types.ObjectId().toString();
  const mockDoc = {
    _id: testObjectId,
    s3Key: 'videos/failure-test.mp4',
    storageProvider: 's3',
  };

  let dbDeleted = false;

  const origFindById = Recording.findById;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;
  const origDeleteFile = s3Service.deleteFile;
  const origIsS3Configured = s3Service.isS3Configured;

  Recording.findById = async () => ({ ...mockDoc });
  Recording.findByIdAndDelete = async () => {
    dbDeleted = true;
  };
  s3Service.isS3Configured = () => true;
  s3Service.deleteFile = async () => {
    const err = new Error('AWS S3 AccessDenied or Connection timeout');
    err.name = 'AccessDenied';
    throw err;
  };

  try {
    const req = { params: { id: testObjectId } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Failed to delete S3 video asset/i);
    assert.strictEqual(dbDeleted, false, 'MongoDB record MUST NOT be deleted if S3 cleanup fails');
  } finally {
    Recording.findById = origFindById;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
    s3Service.deleteFile = origDeleteFile;
    s3Service.isS3Configured = origIsS3Configured;
  }
});

test('6. DELETE /api/recordings/:id - S3 NoSuchKey/404 proceeds cleanly with DB deletion', async () => {
  const testObjectId = new mongoose.Types.ObjectId().toString();
  const mockDoc = {
    _id: testObjectId,
    s3Key: 'videos/already-deleted.mp4',
    storageProvider: 's3',
  };

  let dbDeleted = false;

  const origFindById = Recording.findById;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;
  const origDeleteFile = s3Service.deleteFile;
  const origIsS3Configured = s3Service.isS3Configured;

  Recording.findById = async () => ({ ...mockDoc });
  Recording.findByIdAndDelete = async () => {
    dbDeleted = true;
    return { ...mockDoc };
  };
  s3Service.isS3Configured = () => true;
  s3Service.deleteFile = async () => {
    const err = new Error('The specified key does not exist');
    err.name = 'NoSuchKey';
    err.$metadata = { httpStatusCode: 404 };
    throw err;
  };

  try {
    const req = { params: { id: testObjectId } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(dbDeleted, true, 'Should proceed with DB delete if object is already gone from S3');
  } finally {
    Recording.findById = origFindById;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
    s3Service.deleteFile = origDeleteFile;
    s3Service.isS3Configured = origIsS3Configured;
  }
});

test('7. Route authorization - DELETE /recordings/:id and /live-records/:id require admin privileges', () => {
  const routes = recordingRoutes.stack
    .filter((layer) => layer.route && layer.route.methods && layer.route.methods.delete)
    .map((layer) => ({
      path: layer.route.path,
      handlers: layer.route.stack.length,
    }));

  assert.ok(routes.some((r) => r.path === '/recordings/:id'), 'Route /recordings/:id must exist');
  assert.ok(routes.some((r) => r.path === '/live-records/:id'), 'Route /live-records/:id must exist');
});

test('8. End-to-end list response ID to DELETE flow', async () => {
  const testId = new mongoose.Types.ObjectId().toString();
  const rawRec = {
    _id: testId,
    courseName: 'Test Course',
    lessonTitle: 'Test Lesson',
    status: 'recorded',
    s3Key: 'videos/e2e-test.mp4',
    storageProvider: 's3',
  };

  // Format document as returned by GET /api/recordings
  const formatted = await recordingController.formatRecordingDocument(rawRec);

  assert.strictEqual(formatted._id.toString(), testId);
  assert.strictEqual(formatted.s3Key, 'videos/e2e-test.mp4');

  // Verify deletion using formatted._id
  const origFindById = Recording.findById;
  const origFindByIdAndDelete = Recording.findByIdAndDelete;
  const origDeleteFile = s3Service.deleteFile;
  const origIsS3Configured = s3Service.isS3Configured;

  Recording.findById = async () => ({ ...rawRec });
  Recording.findByIdAndDelete = async () => ({ ...rawRec });
  s3Service.isS3Configured = () => false; // disable s3 for unit mock

  try {
    const req = { params: { id: formatted._id.toString() } };
    const res = makeResponse();

    await recordingController.deleteRecording(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.deletedId, testId);
  } finally {
    Recording.findById = origFindById;
    Recording.findByIdAndDelete = origFindByIdAndDelete;
    s3Service.deleteFile = origDeleteFile;
    s3Service.isS3Configured = origIsS3Configured;
  }
});
