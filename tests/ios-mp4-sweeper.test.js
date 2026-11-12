const test = require('node:test');
const assert = require('node:assert/strict');

const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const iosMp4 = require('../services/iosMp4MediaConvertService');
const { IOS_MP4_MEDIACONVERT_PROFILE } = require('../services/videoConversionService');

const lean = (value) => ({ lean: async () => value });
const course = (keys) => ({
  courseId: 'CRS-1',
  modules: [{ lessons: keys.map((k, i) => ({ _id: `l${i}`, lessonTitle: `L${i}`, videoParts: [{ s3Key: k }] })) }],
});

function loadSweeper() {
  delete require.cache[require.resolve('../services/iosMp4Sweeper')];
  return require('../services/iosMp4Sweeper');
}

test('sweep finishes running jobs, starts missing ones and skips done or exhausted ones', async (t) => {
  const records = [
    { originalS3Key: 'videos/done.mp4', status: 'completed', encodeProfile: IOS_MP4_MEDIACONVERT_PROFILE },
    { originalS3Key: 'videos/running.mp4', status: 'processing', iosMp4JobId: 'job-run' },
    { originalS3Key: 'videos/old-remux.mp4', status: 'completed', encodeProfile: '' },
    { originalS3Key: 'videos/gave-up.mp4', status: 'failed', attempts: 3 },
    { originalS3Key: 'videos/retry.mp4', status: 'failed', attempts: 1 },
  ];
  t.mock.method(Course, 'find', () => lean([course(['videos/done.mp4', 'videos/running.mp4', 'videos/old-remux.mp4', 'videos/gave-up.mp4', 'videos/retry.mp4', 'videos/new.mp4', 'videos/new_ios.mp4'])]));
  t.mock.method(Recording, 'find', () => lean([]));
  t.mock.method(VideoConversion, 'find', (filter) => lean(filter.status === 'processing'
    ? records.filter((r) => r.status === 'processing')
    : records));
  const checked = [];
  const submitted = [];
  t.mock.method(iosMp4, 'checkIosMp4Job', async (jobId) => { checked.push(jobId); return { status: 'completed' }; });
  t.mock.method(iosMp4, 'submitIosMp4Job', async (key) => { submitted.push(key); return { state: 'submitted' }; });

  const { runIosMp4Sweep } = loadSweeper();
  const summary = await runIosMp4Sweep();

  assert.deepEqual(checked, ['job-run']);
  assert.deepEqual(submitted.sort(), ['videos/new.mp4', 'videos/old-remux.mp4', 'videos/retry.mp4']);
  assert.equal(summary.completed, 1);
  assert.equal(summary.submitted, 3);
});

test('sweep limits how many new jobs it starts per run', async (t) => {
  const keys = Array.from({ length: 15 }, (_, i) => `videos/v${i}.mp4`);
  t.mock.method(Course, 'find', () => lean([course(keys)]));
  t.mock.method(Recording, 'find', () => lean([]));
  t.mock.method(VideoConversion, 'find', () => lean([]));
  t.mock.method(iosMp4, 'checkIosMp4Job', async () => ({}));
  let count = 0;
  t.mock.method(iosMp4, 'submitIosMp4Job', async () => { count += 1; return { state: 'submitted' }; });

  const { runIosMp4Sweep } = loadSweeper();
  await runIosMp4Sweep({ maxNewJobs: 4 });
  assert.equal(count, 4);
});
