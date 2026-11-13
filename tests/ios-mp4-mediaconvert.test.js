const test = require('node:test');
const assert = require('node:assert/strict');

const { s3Client } = require('../config/s3');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const { getM4vKeyForOriginal, isConvertibleVideoKey, IOS_MP4_MEDIACONVERT_PROFILE } = require('../services/videoConversionService');
const { isEligibleVideoKey, handleJobStateChange } = require('../services/mediaConvertService');
const { buildIosMp4JobSettings } = require('../services/iosMp4MediaConvertService');
const { getOriginalKeyCandidates } = require('../utils/iosRendition');

const KEY = 'videos/1792902657064-bdf23c77-pharmacy-5.mp4';

test('iOS rendition is named <original>_ios.mp4', () => {
  assert.equal(getM4vKeyForOriginal(KEY), 'videos/1792902657064-bdf23c77-pharmacy-5_ios.mp4');
  assert.deepEqual(getOriginalKeyCandidates('videos/a_ios.mp4'), ['videos/a.mp4', 'videos/a.webm', 'videos/a.mov']);
  assert.deepEqual(getOriginalKeyCandidates('videos/a_ios.m4v'), ['videos/a.mp4', 'videos/a.webm', 'videos/a.mov']);
});

test('a rendition is never treated as an original video', () => {
  assert.equal(isConvertibleVideoKey('videos/a_ios.mp4'), false);
  assert.equal(isEligibleVideoKey('videos/a_ios.mp4'), false);
  assert.equal(isConvertibleVideoKey(KEY), true);
});

test('MediaConvert job makes a 720p seek-safe MP4 next to the original', () => {
  const job = buildIosMp4JobSettings({ s3Key: KEY, targetKey: getM4vKeyForOriginal(KEY), bucketName: 'bucket' });
  assert.equal(job.UserMetadata.jobType, 'ios-mp4');
  const group = job.Settings.OutputGroups[0];
  assert.equal(group.OutputGroupSettings.Type, 'FILE_GROUP_SETTINGS');
  assert.equal(group.OutputGroupSettings.FileGroupSettings.Destination, 's3://bucket/videos/');
  const out = group.Outputs[0];
  assert.equal(out.NameModifier, '_ios');
  assert.equal(out.Extension, 'mp4');
  assert.equal(out.ContainerSettings.Mp4Settings.MoovPlacement, 'PROGRESSIVE_DOWNLOAD');
  assert.equal(out.VideoDescription.Height, 720);
  const h264 = out.VideoDescription.CodecSettings.H264Settings;
  assert.equal(h264.GopSize, 2);
  assert.equal(h264.GopSizeUnits, 'SECONDS');
  assert.equal(h264.GopClosedCadence, 1);
  assert.equal(h264.FramerateControl, 'SPECIFIED');
  assert.equal(h264.FramerateNumerator, 30);
  assert.equal(h264.CodecProfile, 'MAIN');
  assert.equal(job.Settings.Inputs[0].FileInput, `s3://bucket/${KEY}`);
});

test('webhook sends ios-mp4 jobs to their own handler, not the HLS one', async (t) => {
  const updates = [];
  t.mock.method(s3Client, 'send', async () => ({ ContentLength: 12345 }));
  t.mock.method(VideoConversion, 'findOneAndUpdate', async (filter, update) => { updates.push({ filter, update }); return {}; });
  t.mock.method(VideoConversion, 'findOne', async () => { throw new Error('HLS path must not run'); });
  t.mock.method(Course, 'find', async () => []);
  t.mock.method(Recording, 'find', async () => []);

  const result = await handleJobStateChange({
    detail: {
      jobId: 'job-1',
      status: 'COMPLETE',
      userMetadata: { jobType: 'ios-mp4', s3Key: KEY, targetKey: getM4vKeyForOriginal(KEY) },
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].filter.originalS3Key, KEY);
  const set = updates[0].update.$set;
  assert.equal(set.m4vS3Key, getM4vKeyForOriginal(KEY));
  assert.equal(set.encodeProfile, IOS_MP4_MEDIACONVERT_PROFILE);
  assert.equal(set.status, 'completed');
  assert.equal('hlsConversionStatus' in set, false);
});

test('job applies rotation metadata and can drop audio for silent videos', () => {
  const normal = buildIosMp4JobSettings({ s3Key: KEY, targetKey: getM4vKeyForOriginal(KEY), bucketName: 'bucket' });
  assert.equal(normal.Settings.Inputs[0].VideoSelector.Rotate, 'AUTO');
  assert.ok(normal.Settings.Inputs[0].AudioSelectors);
  assert.equal(normal.Settings.OutputGroups[0].Outputs[0].AudioDescriptions.length, 1);
  assert.equal(normal.UserMetadata.videoOnly, 'false');

  const silent = buildIosMp4JobSettings({ s3Key: KEY, targetKey: getM4vKeyForOriginal(KEY), bucketName: 'bucket', videoOnly: true });
  assert.equal(silent.Settings.Inputs[0].AudioSelectors, undefined);
  assert.equal(silent.Settings.OutputGroups[0].Outputs[0].AudioDescriptions, undefined);
  assert.equal(silent.UserMetadata.videoOnly, 'true');
});

test('an audio error is retried once as a video-only job', async (t) => {
  const mcConfig = require('../config/mediaconvert');
  const sent = [];
  t.mock.method(mcConfig, 'getMediaConvertClient', async () => ({
    send: async (cmd) => { sent.push(cmd.input); return { Job: { Id: `job-${sent.length}` } }; },
  }));
  t.mock.method(VideoConversion, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(VideoConversion, 'findOneAndUpdate', async () => ({}));
  t.mock.method(Course, 'find', async () => []);
  t.mock.method(Recording, 'find', async () => []);
  delete require.cache[require.resolve('../services/iosMp4MediaConvertService')];
  const { handleIosMp4JobState } = require('../services/iosMp4MediaConvertService');

  const first = await handleIosMp4JobState({
    jobId: 'job-0',
    status: 'ERROR',
    errorMessage: 'No audio track found in input',
    userMetadata: { s3Key: KEY, videoOnly: 'false' },
  });
  assert.equal(first.status, 'processing');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].UserMetadata.videoOnly, 'true');
  assert.equal(sent[0].Settings.OutputGroups[0].Outputs[0].AudioDescriptions, undefined);

  // A video-only job that fails again is recorded as failed, not retried forever.
  const second = await handleIosMp4JobState({
    jobId: 'job-1',
    status: 'ERROR',
    errorMessage: 'No audio track found in input',
    userMetadata: { s3Key: KEY, videoOnly: 'true' },
  });
  assert.equal(second.status, 'failed');
  assert.equal(sent.length, 1);
});
