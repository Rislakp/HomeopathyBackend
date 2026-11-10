const test = require('node:test');
const assert = require('node:assert/strict');
const s3 = require('../config/s3');
const { mediaConvertConfig } = require('../config/mediaconvert');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const DemoVideo = require('../models/DemoVideo');
const VideoConversion = require('../models/VideoConversion');
const { handleJobStateChange, getHlsConversionStatus } = require('../services/mediaConvertService');

const videoId = 'actual-output-video';
const s3Key = 'videos/actual-output-video.mp4';
const bucket = mediaConvertConfig.bucket;
const masterKey = `hls/${videoId}/master-list.m3u8`;
const variant480Key = `hls/${videoId}/high-rendition.m3u8`;
const variant360Key = `hls/${videoId}/low-rendition.m3u8`;
const segment480Key = `hls/${videoId}/high-00001.ts`;
const segment360Key = `hls/${videoId}/low-00001.ts`;
const outputGroupDetails = [{
  type: 'HLS_GROUP',
  playlistFilePaths: [`s3://${bucket}/${masterKey}`],
  outputDetails: [
    { outputFilePaths: [`s3://${bucket}/${variant480Key}`], videoDetails: { heightInPx: 480 } },
    { outputFilePaths: [`s3://${bucket}/${variant360Key}`], videoDetails: { heightInPx: 360 } },
  ],
}];
const masterPlaylist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1116x480\nhigh-rendition.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=838x360\nlow-rendition.m3u8\n';
const variant480 = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.000,\nhigh-00001.ts\n#EXT-X-ENDLIST\n';
const variant360 = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.000,\nlow-00001.ts\n#EXT-X-ENDLIST\n';

function installMocks(t, { missing = false } = {}) {
  const originals = {
    send: s3.s3Client.send,
    findOne: VideoConversion.findOne,
    findOneAndUpdate: VideoConversion.findOneAndUpdate,
    courseUpdateMany: Course.updateMany,
    recordingUpdateMany: Recording.updateMany,
    demoUpdateMany: DemoVideo.updateMany,
  };
  let persistedUpdate = null;
  t.after(() => {
    s3.s3Client.send = originals.send;
    VideoConversion.findOne = originals.findOne;
    VideoConversion.findOneAndUpdate = originals.findOneAndUpdate;
    Course.updateMany = originals.courseUpdateMany;
    Recording.updateMany = originals.recordingUpdateMany;
    DemoVideo.updateMany = originals.demoUpdateMany;
  });

  VideoConversion.findOne = async () => ({
    originalS3Key: s3Key,
    videoId,
    mediaConvertJobId: 'job-readiness',
    ...(persistedUpdate || {}),
  });
  VideoConversion.findOneAndUpdate = async (_query, update) => {
    persistedUpdate = update.$set;
    return update.$set;
  };
  Course.updateMany = async () => ({ modifiedCount: 1 });
  Recording.updateMany = async () => ({ modifiedCount: 1 });
  DemoVideo.updateMany = async () => ({ modifiedCount: 1 });
  s3.s3Client.send = async (command) => {
    if (missing) {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    if (command.constructor?.name === 'HeadObjectCommand') return { ContentLength: 256 };
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = ({ [masterKey]: masterPlaylist, [variant480Key]: variant480, [variant360Key]: variant360 })[command.input.Key];
      if (!text) throw new Error(`Unexpected playlist key: ${command.input.Key}`);
      return { Body: { transformToString: async () => text } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };

  return { getPersistedUpdate: () => persistedUpdate };
}

test('COMPLETE with missing HLS outputs is recorded as FAILED and uses fallback instead of exposing a guessed playlist', async (t) => {
  const mocks = installMocks(t, { missing: true });
  const result = await handleJobStateChange({
    detail: {
      jobId: 'job-readiness',
      status: 'COMPLETE',
      userMetadata: { s3Key, videoId },
      outputGroupDetails,
    },
  });

  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /output files are missing or unreadable/i);
  assert.equal(mocks.getPersistedUpdate().hlsConversionStatus, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsMasterUrl, '');
});

test('COMPLETE persists actual MediaConvert master and 360p/480p paths after file and playlist validation', async (t) => {
  const mocks = installMocks(t);
  const result = await handleJobStateChange({
    detail: {
      jobId: 'job-readiness',
      status: 'COMPLETE',
      userMetadata: { s3Key, videoId },
      outputGroupDetails,
    },
  });

  const actualMasterUrl = `https://media.whitecoat.academy/${masterKey}`;
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.hlsMasterUrl, actualMasterUrl);
  assert.equal(result.hlsOutputPrefix, `hls/${videoId}/`);
  assert.equal(mocks.getPersistedUpdate().hlsMasterUrl, actualMasterUrl);
  assert.equal(mocks.getPersistedUpdate().hlsOutputPrefix, `hls/${videoId}/`);

  const status = await getHlsConversionStatus(s3Key);
  assert.equal(status.hlsConversionStatus, 'COMPLETED');
  assert.equal(status.hlsMasterUrl, actualMasterUrl);
});

test('COMPLETE rejects a master playlist that omits a reported variant', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'HeadObjectCommand') return { ContentLength: 256 };
    if (command.constructor?.name === 'GetObjectCommand') {
      return { Body: { transformToString: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nhigh-rendition.m3u8\n' } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({
    detail: {
      jobId: 'job-readiness',
      status: 'COMPLETE',
      userMetadata: { s3Key, videoId },
      outputGroupDetails,
    },
  });
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /does not reference both reported variant playlists/i);
  assert.equal(mocks.getPersistedUpdate().hlsMasterUrl, '');
});

test('COMPLETE rejects malformed media manifests and playlists without ENDLIST', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'HeadObjectCommand') return { ContentLength: 256 };
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = command.input.Key === masterKey ? masterPlaylist
        : command.input.Key === variant480Key ? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:7.0,\nhigh-00001.ts\n'
          : variant360;
      return { Body: { transformToString: async () => text } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({ detail: { jobId: 'job-readiness', status: 'COMPLETE', userMetadata: { s3Key, videoId }, outputGroupDetails } });
  assert.equal(result.status, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsMasterUrl, '');
});

test('COMPLETE rejects a missing referenced segment', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = ({ [masterKey]: masterPlaylist, [variant480Key]: variant480, [variant360Key]: variant360 })[command.input.Key];
      return { Body: { transformToString: async () => text } };
    }
    if (command.constructor?.name === 'HeadObjectCommand') {
      if (command.input.Key === segment480Key) {
        const error = new Error('NotFound'); error.name = 'NotFound'; error.$metadata = { httpStatusCode: 404 }; throw error;
      }
      return { ContentLength: 256 };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({ detail: { jobId: 'job-readiness', status: 'COMPLETE', userMetadata: { s3Key, videoId }, outputGroupDetails } });
  assert.equal(result.status, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsMasterUrl, '');
});

test('COMPLETE rejects variant playlists with different segment durations', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'HeadObjectCommand') return { ContentLength: 256 };
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = command.input.Key === masterKey ? masterPlaylist
        : command.input.Key === variant480Key ? variant480
          : variant360.replace('#EXTINF:6.000,', '#EXTINF:5.750,');
      return { Body: { transformToString: async () => text } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({ detail: { jobId: 'job-readiness', status: 'COMPLETE', userMetadata: { s3Key, videoId }, outputGroupDetails } });
  assert.equal(result.status, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsConversionStatus, 'FAILED');
});

test('COMPLETE rejects rendition playlists with discontinuities at different segment boundaries', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'HeadObjectCommand') return { ContentLength: 256 };
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = command.input.Key === masterKey ? masterPlaylist
        : command.input.Key === variant480Key ? variant480
          : variant360.replace('#EXTINF:6.000,', '#EXT-X-DISCONTINUITY\n#EXTINF:6.000,');
      return { Body: { transformToString: async () => text } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({ detail: { jobId: 'job-readiness', status: 'COMPLETE', userMetadata: { s3Key, videoId }, outputGroupDetails } });
  assert.equal(result.status, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsConversionStatus, 'FAILED');
});

test('COMPLETE verifies fMP4 initialization maps as well as media segments', async (t) => {
  const mocks = installMocks(t);
  s3.s3Client.send = async (command) => {
    if (command.constructor?.name === 'HeadObjectCommand') {
      if (command.input.Key === `hls/${videoId}/init-low.mp4`) {
        const error = new Error('NotFound'); error.name = 'NotFound'; error.$metadata = { httpStatusCode: 404 }; throw error;
      }
      return { ContentLength: 256 };
    }
    if (command.constructor?.name === 'GetObjectCommand') {
      const text = command.input.Key === masterKey ? masterPlaylist
        : command.input.Key === variant480Key ? variant480.replace('#EXTINF:', '#EXT-X-MAP:URI="init-high.mp4"\n#EXTINF:')
          : variant360.replace('#EXTINF:', '#EXT-X-MAP:URI="init-low.mp4"\n#EXTINF:');
      return { Body: { transformToString: async () => text } };
    }
    throw new Error(`Unexpected S3 command: ${command.constructor?.name}`);
  };
  const result = await handleJobStateChange({ detail: { jobId: 'job-readiness', status: 'COMPLETE', userMetadata: { s3Key, videoId }, outputGroupDetails } });
  assert.equal(result.status, 'FAILED');
  assert.equal(mocks.getPersistedUpdate().hlsConversionStatus, 'FAILED');
});
