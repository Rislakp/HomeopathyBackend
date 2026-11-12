const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const s3 = require('../config/s3');
const Course = require('../models/Course');
const VideoConversion = require('../models/VideoConversion');
const {
  attachVerifiedM4vRendition,
  hasSafeM4vKey,
} = require('../controllers/studentCurriculumController');
const {
  hasFastStartMoov,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
} = require('../services/videoConversionService');

const savedCredentials = s3.s3Client.config.credentials;
const savedSend = s3.s3Client.send;
s3.s3Client.config.credentials = async () => ({
  accessKeyId: 'LOCALTEST',
  secretAccessKey: 'local-test-only',
});

process.on('exit', () => {
  s3.s3Client.config.credentials = savedCredentials;
  s3.s3Client.send = savedSend;
});

test('1. Course schema validates M4V rendition fields on videoParts and lessons', () => {
  const course = new Course({
    courseTitle: 'M4V Model Test',
    instructor: 'Faculty',
    price: 0,
    modules: [
      {
        moduleName: 'Module 1',
        lessons: [
          {
            lessonTitle: 'Cardiology Part 1',
            m4vS3Key: 'videos/cardio_ios.m4v',
            m4vStorageProvider: 's3',
            m4vConversionStatus: 'completed',
            videoParts: [
              {
                title: 'Part 1',
                storageProvider: 's3',
                s3Key: 'videos/cardio.mp4',
                m4vS3Key: 'videos/cardio_ios.m4v',
                m4vStorageProvider: 's3',
                m4vConversionStatus: 'completed',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(course.validateSync(), undefined);
  const part = course.modules[0].lessons[0].videoParts[0];
  assert.equal(part.s3Key, 'videos/cardio.mp4');
  assert.equal(part.m4vS3Key, 'videos/cardio_ios.m4v');
  assert.equal(part.m4vStorageProvider, 's3');
  assert.equal(part.m4vConversionStatus, 'completed');

  const lesson = course.modules[0].lessons[0];
  assert.equal(lesson.m4vS3Key, 'videos/cardio_ios.m4v');
  assert.equal(lesson.m4vConversionStatus, 'completed');
});

test('2. VideoConversion model tracks conversion pipeline and attempts', () => {
  const conv = new VideoConversion({
    originalS3Key: 'videos/lecture123.mp4',
    m4vS3Key: 'videos/lecture123_ios.m4v',
    status: 'completed',
    duration: 3600,
    fileSize: 450000000,
    attempts: 1,
  });

  assert.equal(conv.validateSync(), undefined);
  assert.equal(conv.originalS3Key, 'videos/lecture123.mp4');
  assert.equal(conv.m4vS3Key, 'videos/lecture123_ios.m4v');
  assert.equal(conv.status, 'completed');
  assert.equal(conv.duration, 3600);
});

test('3. Key derivation and validation for M4V renditions', () => {
  assert.equal(getM4vKeyForOriginal('videos/lecture.mp4'), 'videos/lecture_ios.mp4');
  assert.equal(getM4vKeyForOriginal('videos/rec.webm'), 'videos/rec_ios.mp4');
  assert.equal(getM4vKeyForOriginal('videos/test_ios.m4v'), 'videos/test_ios.m4v');

  assert.equal(isConvertibleVideoKey('videos/123-lecture.mp4'), true);
  assert.equal(isConvertibleVideoKey('videos/123-lecture.webm'), true);
  assert.equal(isConvertibleVideoKey('live_records/rec.mp4'), true);
  assert.equal(isConvertibleVideoKey('documents/notes.pdf'), false);
  assert.equal(isConvertibleVideoKey('images/thumb.jpg'), false);

  assert.equal(hasSafeM4vKey('videos/123-lecture_ios.m4v'), true);
  assert.equal(hasSafeM4vKey('videos/123-lecture_ios.mp4'), true);
  assert.equal(hasSafeM4vKey('videos/123-lecture.mp4'), false);
  assert.equal(hasSafeM4vKey('videos/../escape.m4v'), false);
  assert.equal(hasSafeM4vKey('other/file.m4v'), false);
});

test('4. attachVerifiedM4vRendition signs M4V when present in S3 and preserves original MP4', async (t) => {
  const originalSend = s3.s3Client.send;
  s3.s3Client.send = async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') {
      return { ContentLength: 5000000, ContentType: 'video/mp4' };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };
  t.after(() => {
    s3.s3Client.send = originalSend;
  });

  const resource = {
    title: 'Pharmacology Lecture',
    url: 'https://media.example/videos/pharm.mp4?sig=mp4',
    s3Key: 'videos/pharm.mp4',
    storageProvider: 's3',
    m4vS3Key: 'videos/pharm_ios.m4v',
    m4vStorageProvider: 's3',
    m4vConversionStatus: 'completed',
  };

  const result = await attachVerifiedM4vRendition(resource);

  // Original MP4 remains completely unchanged
  assert.equal(result.url, 'https://media.example/videos/pharm.mp4?sig=mp4');
  assert.equal(result.s3Key, 'videos/pharm.mp4');

  // Converted M4V is signed and attached
  assert.equal(result.m4vS3Key, 'videos/pharm_ios.m4v');
  assert.equal(result.m4vStorageProvider, 's3');
  assert.equal(result.m4vConversionStatus, 'completed');
  assert.ok(result.m4vUrl, 'm4vUrl must be present');
  assert.ok(result.iosM4vUrl, 'iosM4vUrl must be present');
  assert.equal(result.m4vUrl, result.iosM4vUrl);
});

test('5. attachVerifiedM4vRendition safely falls back when M4V is pending or unavailable without breaking MP4', async (t) => {
  const originalSend = s3.s3Client.send;
  s3.s3Client.send = async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') {
      const err = new Error('NotFound');
      err.name = 'NotFound';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };
  t.after(() => {
    s3.s3Client.send = originalSend;
  });

  const resource = {
    title: 'Pending Lecture',
    url: 'https://media.example/videos/pending.mp4?sig=mp4',
    s3Key: 'videos/pending.mp4',
    storageProvider: 's3',
    m4vS3Key: 'videos/pending_ios.m4v',
    m4vStorageProvider: 's3',
    m4vConversionStatus: 'pending',
  };

  const result = await attachVerifiedM4vRendition(resource);

  // Original MP4 remains 100% playable
  assert.equal(result.url, 'https://media.example/videos/pending.mp4?sig=mp4');
  assert.equal(result.s3Key, 'videos/pending.mp4');
  assert.equal(result.m4vUrl, undefined);
  assert.equal(result.iosM4vUrl, undefined);
});

test('6. FastStart atom detector accurately distinguishes moov-before-mdat', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststart-test-'));
  const fastStartFile = path.join(tmpDir, 'faststart.m4v');
  const normalFile = path.join(tmpDir, 'normal.mp4');

  // Create mock MP4 with moov atom before mdat
  const moovAtom = Buffer.alloc(32);
  moovAtom.writeUInt32BE(16, 0);
  moovAtom.write('moov', 4, 4, 'ascii');
  moovAtom.writeUInt32BE(16, 16);
  moovAtom.write('mdat', 20, 4, 'ascii');
  fs.writeFileSync(fastStartFile, moovAtom);

  // Create mock MP4 with mdat atom before moov
  const mdatAtom = Buffer.alloc(32);
  mdatAtom.writeUInt32BE(16, 0);
  mdatAtom.write('mdat', 4, 4, 'ascii');
  mdatAtom.writeUInt32BE(16, 16);
  mdatAtom.write('moov', 20, 4, 'ascii');
  fs.writeFileSync(normalFile, mdatAtom);

  assert.equal(hasFastStartMoov(fastStartFile), true);
  assert.equal(hasFastStartMoov(normalFile), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

