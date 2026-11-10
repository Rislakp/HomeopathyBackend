const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const s3 = require('../config/s3');
const Course = require('../models/Course');
const { attachVerifiedMp4Fallback } = require('../controllers/studentCurriculumController');
const { hasFastStartMoov } = require('../scripts/remux_and_fix_webm');

const savedCredentials = s3.s3Client.config.credentials;
const savedSend = s3.s3Client.send;
s3.s3Client.config.credentials = async () => ({ accessKeyId: 'LOCALTEST', secretAccessKey: 'local-test-only' });
process.on('exit', () => {
  s3.s3Client.config.credentials = savedCredentials;
  s3.s3Client.send = savedSend;
});

test('Course video resource schema stores explicit MP4 fallback references', () => {
  const course = new Course({
    courseTitle: 'Fallback model test', instructor: 'Test', price: 0,
    modules: [{ moduleName: 'Module', lessons: [{
      lessonTitle: 'Lesson',
      videoParts: [{
        title: 'Lecture', storageProvider: 's3', s3Key: 'videos/lecture.webm',
        mp4StorageProvider: 's3', mp4S3Key: 'videos/lecture-h264-aac.mp4',
      }],
    }] }],
  });
  assert.equal(course.validateSync(), undefined);
  const item = course.modules[0].lessons[0].videoParts[0];
  assert.equal(item.s3Key, 'videos/lecture.webm');
  assert.equal(item.mp4S3Key, 'videos/lecture-h264-aac.mp4');
  assert.equal(item.mp4StorageProvider, 's3');
});

test('WebM fallback is signed only when its explicit MP4 object exists', async (t) => {
  const originalSend = s3.s3Client.send;
  const seen = [];
  s3.s3Client.send = async (command) => {
    seen.push(command);
    if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 1024, ContentType: 'video/mp4' };
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };
  t.after(() => { s3.s3Client.send = originalSend; });

  const result = await attachVerifiedMp4Fallback({
    title: 'Lecture 1',
    url: 'https://media.example/videos/lecture.webm?signature=original',
    s3Key: 'videos/lecture.webm',
    storageProvider: 's3',
    mp4S3Key: 'videos/lecture-h264-aac.mp4',
    mp4StorageProvider: 's3',
  });
  assert.equal(result.url, 'https://media.example/videos/lecture.webm?signature=original', 'primary WebM remains intact');
  assert.equal(result.s3Key, 'videos/lecture.webm');
  assert.equal(result.mp4S3Key, 'videos/lecture-h264-aac.mp4');
  assert.equal(result.mp4StorageProvider, 's3');
  assert.equal(result.mp4Url, result.fallbackVideoUrl);
  const signed = new URL(result.mp4Url);
  assert.equal(signed.searchParams.get('response-content-type'), 'video/mp4');
  assert.equal(signed.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.deepEqual(seen.map((command) => command.constructor.name), ['HeadObjectCommand']);
  assert.equal(seen[0].input.Key, 'videos/lecture-h264-aac.mp4');
});

test('missing, unsafe, or non-WebM fallbacks are never exposed', async (t) => {
  const originalSend = s3.s3Client.send;
  s3.s3Client.send = async () => { const error = new Error('missing'); error.name = 'NotFound'; throw error; };
  t.after(() => { s3.s3Client.send = originalSend; });

  const missing = await attachVerifiedMp4Fallback({
    title: 'Lecture', s3Key: 'videos/lecture.webm', storageProvider: 's3',
    mp4S3Key: 'videos/missing.mp4', mp4StorageProvider: 's3',
    mp4Url: 'https://attacker.invalid/fallback.mp4',
  });
  for (const key of ['mp4S3Key', 'mp4StorageProvider', 'mp4Url', 'fallbackVideoUrl']) assert.equal(missing[key], undefined);

  const unsafe = await attachVerifiedMp4Fallback({
    title: 'Lecture', s3Key: 'videos/lecture.webm', storageProvider: 's3',
    mp4S3Key: '../private/lecture.mp4', mp4StorageProvider: 's3',
  });
  assert.equal(unsafe.mp4S3Key, undefined);

  const mp4Only = await attachVerifiedMp4Fallback({
    title: 'MP4 Lecture', s3Key: 'videos/lecture.mp4', storageProvider: 's3',
    mp4S3Key: 'videos/other.mp4', mp4StorageProvider: 's3',
  });
  assert.equal(mp4Only.s3Key, 'videos/lecture.mp4');
  assert.equal(mp4Only.mp4S3Key, undefined);
});

test('remux output validator requires moov before media data', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-faststart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const atom = (name) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(8, 0);
    buffer.write(name, 4, 'ascii');
    return buffer;
  };
  const fastStart = path.join(dir, 'faststart.mp4');
  fs.writeFileSync(fastStart, Buffer.concat([atom('ftyp'), atom('moov'), atom('mdat')]));
  assert.equal(hasFastStartMoov(fastStart), true);

  const slowStart = path.join(dir, 'slowstart.mp4');
  fs.writeFileSync(slowStart, Buffer.concat([atom('ftyp'), atom('mdat'), atom('moov')]));
  assert.equal(hasFastStartMoov(slowStart), false);
});
