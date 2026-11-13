const test = require('node:test');
const assert = require('node:assert/strict');
const s3 = require('../config/s3');
const VideoConversion = require('../models/VideoConversion');
const { getIosPlaybackState, markProcessing } = require('../utils/iosPlaybackState');

const NOW = Date.UTC(2026, 10, 13, 6, 0, 0);
const key = (msAgo) => `videos/${NOW - msAgo}-abc-lecture.mp4`;
const MIN = 60 * 1000;

function mockS3(t, exists) {
  t.mock.method(s3.s3Client, 'send', async () => {
    if (!exists) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
    return { ContentLength: 1000 };
  });
}

test('ready when a seek-safe rendition exists', async (t) => {
  mockS3(t, true);
  const k = key(5 * MIN);
  const r = await getIosPlaybackState(k, { now: NOW, record: { status: 'completed', encodeProfile: 'mediaconvert-720p-v1', m4vS3Key: k.replace('.mp4', '_ios.mp4') } });
  assert.equal(r.state, 'ready');
  assert.equal(r.renditionKey, k.replace('.mp4', '_ios.mp4'));
});

test('processing while the job runs, original once it has been stuck for over 3 hours', async (t) => {
  mockS3(t, false);
  const k = key(5 * MIN);
  assert.equal((await getIosPlaybackState(k, { now: NOW, record: { status: 'processing', lastAttemptAt: new Date(NOW - 4 * MIN) } })).state, 'processing');
  assert.equal((await getIosPlaybackState(k, { now: NOW, record: { status: 'processing', lastAttemptAt: new Date(NOW - 200 * MIN) } })).state, 'original');
});

test('brand-new upload with no record yet is processing; an old one without a record is not', async (t) => {
  mockS3(t, false);
  assert.equal((await getIosPlaybackState(key(2 * MIN), { now: NOW, record: null })).state, 'processing');
  assert.equal((await getIosPlaybackState(key(120 * MIN), { now: NOW, record: null })).state, 'original');
});

test('failed: processing while retries remain, original after the last attempt', async (t) => {
  mockS3(t, false);
  const k = key(10 * MIN);
  const at = new Date(NOW - 5 * MIN);
  assert.equal((await getIosPlaybackState(k, { now: NOW, record: { status: 'failed', attempts: 1, lastAttemptAt: at } })).state, 'processing');
  assert.equal((await getIosPlaybackState(k, { now: NOW, record: { status: 'failed', attempts: 3, lastAttemptAt: at } })).state, 'original');
});

test('HIDE_UNCONVERTED_VIDEOS=false always falls back to the original', async (t) => {
  mockS3(t, false);
  process.env.HIDE_UNCONVERTED_VIDEOS = 'false';
  t.after(() => { delete process.env.HIDE_UNCONVERTED_VIDEOS; });
  assert.equal((await getIosPlaybackState(key(2 * MIN), { now: NOW, record: { status: 'processing', lastAttemptAt: new Date(NOW) } })).state, 'original');
});

test('rendition keys and non-video keys are never hidden', async () => {
  assert.equal((await getIosPlaybackState('videos/1794546542127-a_ios.mp4', { record: null })).state, 'original');
  assert.equal((await getIosPlaybackState('pdfs/1794546542127-a.pdf', { record: null })).state, 'original');
});

test('markProcessing removes every playable link', () => {
  const item = markProcessing({ url: 'u', videoUrl: 'v', mp4Url: 'm', hlsMasterUrl: 'h', s3Key: 'videos/a.mp4', title: 'A' });
  for (const f of ['url', 'videoUrl', 'mp4Url', 'hlsMasterUrl']) assert.equal(item[f], '');
  assert.equal(item.videoProcessing, true);
  assert.equal(item.playbackType, 'processing');
  assert.equal(item.s3Key, 'videos/a.mp4');
  assert.ok(item.processingMessage);
});

test('student course API hides an unconverted new video and keeps converted ones', async (t) => {
  const { addSignedS3MediaUrls } = require('../controllers/studentCurriculumController');
  const newKey = `videos/${Date.now() - 2 * MIN}-abc-new.mp4`;
  const doneKey = `videos/${Date.now() - 2 * MIN}-abc-done.mp4`;
  t.mock.method(s3.s3Client, 'send', async (cmd) => {
    if (cmd.input?.Key === doneKey.replace('.mp4', '_ios.mp4') || cmd.input?.Key === newKey || cmd.input?.Key === doneKey) return { ContentLength: 1000, ContentType: 'video/mp4' };
    throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
  });
  t.mock.method(VideoConversion, 'findOne', (filter) => ({
    lean: async () => (filter.originalS3Key === doneKey
      ? { originalS3Key: doneKey, status: 'completed', encodeProfile: 'mediaconvert-720p-v1', m4vS3Key: doneKey.replace('.mp4', '_ios.mp4') }
      : { originalS3Key: newKey, status: 'processing', lastAttemptAt: new Date() }),
  }));
  const course = {
    courseId: 'CRS-T',
    modules: [{ lessons: [
      { lessonTitle: 'New', videoParts: [{ storageProvider: 's3', s3Key: newKey, title: 'new' }] },
      { lessonTitle: 'Done', videoParts: [{ storageProvider: 's3', s3Key: doneKey, title: 'done' }] },
    ] }],
  };
  const out = await addSignedS3MediaUrls(course);
  const [fresh, done] = out.modules[0].lessons;
  assert.equal(fresh.videoProcessing, true);
  assert.equal(fresh.videoUrl, '');
  assert.equal(fresh.videoParts[0].url, '');
  assert.equal(fresh.videoParts[0].videoProcessing, true);
  assert.ok(!done.videoProcessing);
  assert.ok(done.videoUrl.includes('_ios.mp4'));
});
