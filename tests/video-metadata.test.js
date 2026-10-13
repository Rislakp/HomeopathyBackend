const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { s3Client, bucket } = require('../config/s3');
const { CompleteMultipartUploadCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const s3UploadController = require('../controllers/s3UploadController');
const courseController = require('../controllers/courseController');
const recordingController = require('../controllers/recordingController');
const Course = require('../models/Course');
const Recording = require('../models/Recording');

const makeResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };
  return res;
};

test('1. S3 Multipart completion persists accurate fileSize, bytes, and duration in media reference', async (t) => {
  const originalSend = s3Client.send;
  t.after(() => {
    s3Client.send = originalSend;
  });

  const testKey = 'videos/1791000000000-test-lecture.mp4';
  const expectedBytes = 78643200; // 75 MB
  const expectedDurationSec = 1450; // 24m 10s

  s3Client.send = async (command) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      return {
        Bucket: bucket,
        Key: testKey,
        Location: `https://${bucket}.s3.amazonaws.com/${testKey}`,
        ETag: '"0123456789abcdef0123456789abcdef"',
      };
    }
    if (command instanceof HeadObjectCommand) {
      return {
        ContentLength: expectedBytes,
        ContentType: 'video/mp4',
        ETag: '"0123456789abcdef0123456789abcdef"',
      };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const req = {
    body: {
      key: testKey,
      uploadId: 'upload-id-123',
      parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
      fileName: 'lecture-test.mp4',
      contentType: 'video/mp4',
      fileSize: expectedBytes,
      duration: expectedDurationSec,
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();

  await s3UploadController.completeMultipartUpload(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.key, testKey);
  assert.ok(res.body.media, 'media reference must be returned');

  // Verify all size fields are consistent
  assert.equal(res.body.media.fileSize, expectedBytes, 'media.fileSize matches S3 HeadObject ContentLength');
  assert.equal(res.body.media.bytes, expectedBytes, 'media.bytes matches ContentLength');
  assert.equal(res.body.media.size, expectedBytes, 'media.size matches ContentLength');

  // Verify duration
  assert.equal(res.body.media.duration, expectedDurationSec, 'media.duration matches input duration');
  assert.equal(res.body.media.videoDuration, expectedDurationSec, 'media.videoDuration matches input duration');
  assert.equal(res.body.media.fileName, 'lecture-test.mp4');
  assert.equal(res.body.media.storageProvider, 's3');
});

test('2. addLesson extracts and persists videoBytes and videoDuration from nested videoParts', async (t) => {
  const originalFindOne = Course.findOne;
  const originalSave = Course.prototype.save;
  t.after(() => {
    Course.findOne = originalFindOne;
    Course.prototype.save = originalSave;
  });

  const course = new Course({
    courseTitle: 'Video Metadata Test Course',
    courseId: 'CRS-META-1',
    modules: [{
      moduleName: 'Module 1',
      lessons: [],
    }],
  });

  Course.findOne = async () => course;
  Course.prototype.save = async function() { return this; };

  const moduleId = course.modules[0]._id.toString();
  const testBytes = 152000000;
  const testDuration = 2400; // 40 minutes

  const req = {
    params: { courseId: 'CRS-META-1', moduleId },
    body: {
      lessonTitle: 'Lecture with Video Parts Only',
      lessonType: 'Recorded Video',
      // Notice: NO top-level videoBytes or videoDuration provided!
      videoParts: [{
        title: 'lecture-part-1.mp4',
        storageProvider: 's3',
        s3Key: 'videos/1791000000000-lecture-part-1.mp4',
        resourceType: 'video',
        contentType: 'video/mp4',
        fileSize: testBytes,
        duration: testDuration,
      }],
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();

  await courseController.addLesson(req, res);

  assert.equal(res.statusCode, 201);
  const savedLesson = course.modules[0].lessons[0];

  // Verify persisted model fields
  assert.equal(savedLesson.videoBytes, testBytes, 'lesson.videoBytes was synced from videoParts[0]');
  assert.equal(savedLesson.videoDuration, testDuration, 'lesson.videoDuration was synced from videoParts[0]');
  assert.equal(savedLesson.durationOrPages, '2400 sec', 'durationOrPages was auto-formatted from videoDuration');

  // Verify serialized response contract
  assert.equal(res.body.data.videoBytes, testBytes, 'Response videoBytes is accurate');
  assert.equal(res.body.data.bytes, testBytes, 'Response bytes is accurate');
  assert.equal(res.body.data.fileSize, testBytes, 'Response fileSize is accurate');
  assert.equal(res.body.data.size, testBytes, 'Response size is accurate');
  assert.equal(res.body.data.videoDuration, testDuration, 'Response videoDuration is accurate');
  assert.equal(res.body.data.duration, testDuration, 'Response duration is accurate');
  assert.equal(res.body.data.durationOrPages, '2400 sec', 'Response durationOrPages is accurate');

  // Verify nested videoParts serialized fields
  const savedPart = res.body.data.videoParts[0];
  assert.equal(savedPart.fileSize, testBytes);
  assert.equal(savedPart.bytes, testBytes);
  assert.equal(savedPart.size, testBytes);
  assert.equal(savedPart.duration, testDuration);
});

test('3. updateLesson cross-syncs metadata when videoParts is updated', async (t) => {
  const originalFindOne = Course.findOne;
  const originalSave = Course.prototype.save;
  t.after(() => {
    Course.findOne = originalFindOne;
    Course.prototype.save = originalSave;
  });

  const course = new Course({
    courseTitle: 'Video Update Course',
    courseId: 'CRS-UPDATE-1',
    modules: [{
      moduleName: 'Module 1',
      lessons: [{
        lessonTitle: 'Existing Lesson',
        lessonType: 'Recorded Video',
        videoBytes: 0,
        videoDuration: 0,
        videoParts: [],
      }],
    }],
  });

  Course.findOne = async () => course;
  Course.prototype.save = async function() { return this; };

  const moduleId = course.modules[0]._id.toString();
  const lessonId = course.modules[0].lessons[0]._id.toString();
  const updatedBytes = 94371840; // 90 MB
  const updatedDuration = 1800; // 30 minutes

  const req = {
    params: { courseId: 'CRS-UPDATE-1', moduleId, lessonId },
    body: {
      lessonTitle: 'Existing Lesson Updated',
      videoParts: [{
        title: 'new-lecture.mp4',
        storageProvider: 's3',
        s3Key: 'videos/new-lecture.mp4',
        resourceType: 'video',
        contentType: 'video/mp4',
        bytes: updatedBytes,
        duration: updatedDuration,
      }],
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();

  await courseController.updateLesson(req, res);

  assert.equal(res.statusCode, 200);
  const updatedLesson = course.modules[0].lessons[0];

  assert.equal(updatedLesson.videoBytes, updatedBytes, 'videoBytes updated from videoParts');
  assert.equal(updatedLesson.videoDuration, updatedDuration, 'videoDuration updated from videoParts');
  assert.equal(res.body.data.videoBytes, updatedBytes);
  assert.equal(res.body.data.videoDuration, updatedDuration);
  assert.equal(res.body.data.fileSize, updatedBytes);
  assert.equal(res.body.data.bytes, updatedBytes);
});

test('4. serializeLesson falls back to videoParts when lesson document has zero metadata', async (t) => {
  const legacyLesson = {
    _id: new mongoose.Types.ObjectId(),
    lessonTitle: 'Legacy Zero-Metadata Lesson',
    lessonType: 'Recorded Video',
    videoDuration: 0,
    videoBytes: 0,
    durationOrPages: '',
    videoParts: [{
      title: 'part-1.mp4',
      storageProvider: 's3',
      s3Key: 'videos/legacy-part.mp4',
      fileSize: 41943040, // 40 MB
      duration: 720,      // 12 min
    }],
    pdfNotes: [],
    assignments: [],
    attachments: [],
  };

  const req = { user: { role: 'admin' } };
  const serialized = await courseController.serializeLesson(legacyLesson, req);

  assert.equal(serialized.videoBytes, 41943040, 'Fallback populated videoBytes from videoParts[0]');
  assert.equal(serialized.bytes, 41943040, 'Fallback populated bytes');
  assert.equal(serialized.fileSize, 41943040, 'Fallback populated fileSize');
  assert.equal(serialized.size, 41943040, 'Fallback populated size');
  assert.equal(serialized.videoDuration, 720, 'Fallback populated videoDuration from videoParts[0]');
  assert.equal(serialized.duration, 720, 'Fallback populated duration');
  assert.equal(serialized.durationOrPages, '720 sec', 'Fallback formatted durationOrPages');
});

test('5. Graceful handling of legacy recordings with completely missing metadata', async (t) => {
  // Legacy recording with 0 bytes and no duration
  const emptyRec = new Recording({
    courseName: 'Older Course',
    lessonTitle: 'Older Lecture',
    bytes: 0,
    duration: '',
    status: 'stopped',
  });

  const formatted = await recordingController.formatRecordingDocument(emptyRec);

  assert.equal(formatted.bytes, 0, 'Bytes is 0');
  assert.equal(formatted.videoBytes, 0, 'videoBytes is 0');
  assert.equal(formatted.fileSize, '', 'fileSize is empty string when bytes is 0 (no fake 12.5 MB placeholder)');
  assert.equal(formatted.duration, '', 'duration is empty string when unknown');
  assert.equal(formatted.videoDuration, 0, 'videoDuration is 0 when unknown');
  assert.ok(!isNaN(formatted.bytes), 'bytes is not NaN');
  assert.ok(!isNaN(formatted.videoDuration), 'videoDuration is not NaN');
});

test('6. uploadRecordingVideo persists actual file size and duration', async (t) => {
  const origFindById = Recording.findById;
  t.after(() => {
    Recording.findById = origFindById;
  });

  const recId = new mongoose.Types.ObjectId();
  const mockRecording = new Recording({
    _id: recId,
    courseName: 'Live Class Recording',
    bytes: 0,
    duration: '',
    status: 'recording',
  });
  mockRecording.save = async function() { return this; };

  Recording.findById = async () => mockRecording;

  const req = {
    params: { id: recId.toString() },
    body: {
      status: 'stopped',
      duration: '18:45',
      videoDuration: 1125,
      bytes: 52428800, // 50 MB
      videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/recording.mp4',
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();

  await recordingController.uploadRecordingVideo(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(mockRecording.bytes, 52428800, 'Recording bytes stored in MongoDB');
  assert.equal(mockRecording.duration, '18:45', 'Recording duration stored in MongoDB');

  assert.equal(res.body.bytes, 52428800, 'Top-level response bytes accurate');
  assert.equal(res.body.data.bytes, 52428800, 'data.bytes accurate');
  assert.equal(res.body.data.videoBytes, 52428800, 'data.videoBytes accurate');
  assert.equal(res.body.data.fileSize, '50 MB', 'data.fileSize properly formatted');
  assert.equal(res.body.data.duration, '18:45', 'data.duration accurate');
});
