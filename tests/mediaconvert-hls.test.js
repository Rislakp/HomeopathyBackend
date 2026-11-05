const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const s3 = require('../config/s3');
const { mediaConvertConfig } = require('../config/mediaconvert');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const DemoVideo = require('../models/DemoVideo');
const Student = require('../models/Student');

const {
  deriveVideoIdFromKey,
  isEligibleVideoKey,
  getCloudFrontHlsMasterUrl,
  buildHlsJobSettings,
  syncHlsDatabaseRecords,
  handleJobStateChange,
  getHlsConversionStatus,
} = require('../services/mediaConvertService');

const {
  generateHlsSignedCookies,
  attachHlsCookiesToResponse,
  generateHlsSignedUrl,
  isCloudFrontSigningConfigured,
} = require('../utils/cloudFrontSecurity');

const {
  attachVerifiedHlsStream,
} = require('../controllers/studentCurriculumController');

const s3Controller = require('../controllers/s3UploadController');

// Mock S3 credentials for unit test isolation
const savedCredentials = s3.s3Client.config.credentials;
s3.s3Client.config.credentials = async () => ({
  accessKeyId: 'LOCALTEST',
  secretAccessKey: 'local-test-only',
});

process.on('exit', () => {
  s3.s3Client.config.credentials = savedCredentials;
});

// Test helper to simulate Express req/res
function mockReqRes(reqData = {}) {
  const req = {
    body: reqData.body || {},
    query: reqData.query || {},
    params: reqData.params || {},
    headers: reqData.headers || {},
    user: reqData.user || { id: 'admin-1', role: 'admin' },
  };
  const res = {
    statusCode: 200,
    cookies: {},
    responseBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.responseBody = data;
      return this;
    },
    cookie(name, val, options) {
      this.cookies[name] = { val, options };
      return this;
    },
  };
  return { req, res };
}

test('1. Course schema validates HLS fields on both lessons and videoParts', () => {
  const course = new Course({
    courseTitle: 'HLS Test Course',
    instructor: 'Faculty',
    price: 0,
    modules: [
      {
        moduleName: 'Module 1',
        lessons: [
          {
            lessonTitle: 'Lesson 1',
            s3Key: 'videos/cardio.mp4',
            originalVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/cardio.mp4',
            hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/master.m3u8',
            hlsOutputPrefix: 'hls/cardio/',
            mediaConvertJobId: 'job-1001',
            hlsConversionStatus: 'COMPLETED',
            hlsConversionError: '',
            hlsConvertedAt: new Date(),
            videoParts: [
              {
                title: 'Part 1',
                storageProvider: 's3',
                s3Key: 'videos/cardio.mp4',
                originalVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/cardio.mp4',
                hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/master.m3u8',
                hlsOutputPrefix: 'hls/cardio/',
                mediaConvertJobId: 'job-1001',
                hlsConversionStatus: 'COMPLETED',
              },
            ],
          },
        ],
      },
    ],
  });

  const valError = course.validateSync();
  assert.equal(valError, undefined);

  const les = course.modules[0].lessons[0];
  assert.equal(les.hlsConversionStatus, 'COMPLETED');
  assert.equal(les.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/master.m3u8');
  assert.equal(les.mediaConvertJobId, 'job-1001');

  const part = les.videoParts[0];
  assert.equal(part.hlsConversionStatus, 'COMPLETED');
  assert.equal(part.hlsOutputPrefix, 'hls/cardio/');
});

test('2. Recording, DemoVideo, and VideoConversion models validate HLS fields', () => {
  const rec = new Recording({
    s3Key: 'videos/live-rec.mp4',
    originalVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/live-rec.mp4',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/live-rec/master.m3u8',
    hlsConversionStatus: 'PROCESSING',
    mediaConvertJobId: 'job-1002',
  });
  assert.equal(rec.validateSync(), undefined);
  assert.equal(rec.hlsConversionStatus, 'PROCESSING');

  const dv = new DemoVideo({
    title: 'Demo Cardiology',
    videoUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/master.m3u8',
    courseId: 'CRS-DEMO-01',
    s3Key: 'videos/demo-cardio.mp4',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/master.m3u8',
    hlsConversionStatus: 'COMPLETED',
  });
  assert.equal(dv.validateSync(), undefined);

  const vc = new VideoConversion({
    originalS3Key: 'videos/demo-cardio.mp4',
    videoId: 'demo-cardio',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/master.m3u8',
    hlsConversionStatus: 'COMPLETED',
    mediaConvertJobId: 'job-1003',
  });
  assert.equal(vc.validateSync(), undefined);
});

test('3. Helper functions: deriveVideoIdFromKey, isEligibleVideoKey, getCloudFrontHlsMasterUrl', () => {
  assert.equal(
    deriveVideoIdFromKey('videos/1715000000000-abcd-cardiology.mp4'),
    '1715000000000-abcd-cardiology'
  );
  assert.equal(
    deriveVideoIdFromKey('live_records/session-01.mov'),
    'session-01'
  );

  assert.equal(isEligibleVideoKey('videos/sample.mp4'), true);
  assert.equal(isEligibleVideoKey('videos/sample.mov'), true);
  assert.equal(isEligibleVideoKey('videos/sample.webm'), true);
  assert.equal(isEligibleVideoKey('videos/sample_ios.m4v'), false);
  assert.equal(isEligibleVideoKey('pdfs/notes.pdf'), false);
  assert.equal(isEligibleVideoKey('hls/sample/master.m3u8'), false);

  assert.equal(
    getCloudFrontHlsMasterUrl('sample-123'),
    'https://d9rfsgqgwn1wa.cloudfront.net/hls/sample-123/master.m3u8'
  );
});

test('4. MediaConvert Job configuration generates exact 480p and 360p adaptive HLS settings', () => {
  const settings = buildHlsJobSettings({
    inputS3Uri: 's3://whitecoat-media-prod/videos/pharmacy-5.mp4',
    outputS3Destination: 's3://whitecoat-media-prod/hls/pharmacy-5/',
    videoId: 'pharmacy-5',
    userMetadata: {
      s3Key: 'videos/pharmacy-5.mp4',
      courseId: 'CRS-000066',
      lessonId: '6ac50c6174ca2bc1975b4961',
    },
  });

  assert.equal(settings.Role, 'arn:aws:iam::951928130471:role/service-role/MediaConvert_Default_Role');
  assert.equal(settings.UserMetadata.videoId, 'pharmacy-5');
  assert.equal(settings.UserMetadata.courseId, 'CRS-000066');
  assert.equal(settings.UserMetadata.lessonId, '6ac50c6174ca2bc1975b4961');

  const group = settings.Settings.OutputGroups[0];
  assert.equal(group.OutputGroupSettings.Type, 'HLS_GROUP_SETTINGS');
  assert.equal(group.OutputGroupSettings.HlsGroupSettings.Destination, 's3://whitecoat-media-prod/hls/pharmacy-5/');
  assert.equal(group.OutputGroupSettings.HlsGroupSettings.SegmentLength, 6);
  assert.equal(group.OutputGroupSettings.HlsGroupSettings.DirectoryStructure, 'SINGLE_DIRECTORY');

  // Verify Outputs: 480p and 360p
  assert.equal(group.Outputs.length, 2);

  // 480p
  const out480p = group.Outputs[0];
  assert.equal(out480p.NameModifier, '_480p');
  assert.equal(out480p.VideoDescription.Width, 1116);
  assert.equal(out480p.VideoDescription.Height, 480);
  assert.equal(out480p.VideoDescription.CodecSettings.Codec, 'H_264');
  assert.equal(out480p.VideoDescription.CodecSettings.H264Settings.RateControlMode, 'QVBR');
  assert.equal(out480p.VideoDescription.CodecSettings.H264Settings.MaxBitrate, 1500000);
  assert.equal(out480p.AudioDescriptions[0].CodecSettings.Codec, 'AAC');
  assert.equal(out480p.AudioDescriptions[0].CodecSettings.AacSettings.Bitrate, 128000);

  // 360p
  const out360p = group.Outputs[1];
  assert.equal(out360p.NameModifier, '_360p');
  assert.equal(out360p.VideoDescription.Width, 838);
  assert.equal(out360p.VideoDescription.Height, 360);
  assert.equal(out360p.VideoDescription.CodecSettings.Codec, 'H_264');
  assert.equal(out360p.VideoDescription.CodecSettings.H264Settings.RateControlMode, 'QVBR');
  assert.equal(out360p.VideoDescription.CodecSettings.H264Settings.MaxBitrate, 800000);
  assert.equal(out360p.AudioDescriptions[0].CodecSettings.Codec, 'AAC');
  assert.equal(out360p.AudioDescriptions[0].CodecSettings.AacSettings.Bitrate, 96000);
});

test('5. EventBridge webhook notification handles COMPLETE and ERROR status transitions', async () => {
  const origFindOneAndUpdate = VideoConversion.findOneAndUpdate;
  const origUpdateManyCourse = Course.updateMany;
  const origUpdateManyRec = Recording.updateMany;
  const origFindOne = VideoConversion.findOne;

  let recordedStatus = null;
  let recordedMasterUrl = null;
  let recordedError = null;

  VideoConversion.findOneAndUpdate = async (query, update) => {
    recordedStatus = update.$set.hlsConversionStatus;
    recordedMasterUrl = update.$set.hlsMasterUrl;
    recordedError = update.$set.hlsConversionError;
    return { ...query, ...update.$set };
  };
  VideoConversion.findOne = () => ({
    lean: async () => ({
      originalS3Key: 'videos/test-session.mp4',
      videoId: 'test-session',
      mediaConvertJobId: 'job-999',
    }),
  });
  Course.updateMany = async () => ({ modifiedCount: 1 });
  Recording.updateMany = async () => ({ modifiedCount: 1 });

  try {
    // 5.1 Test COMPLETE
    const resComplete = await handleJobStateChange({
      detail: {
        jobId: 'job-999',
        status: 'COMPLETE',
        userMetadata: {
          s3Key: 'videos/test-session.mp4',
          videoId: 'test-session',
        },
      },
    });

    assert.equal(resComplete.success, true);
    assert.equal(resComplete.status, 'COMPLETED');
    assert.equal(resComplete.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/test-session/master.m3u8');
    assert.equal(recordedStatus, 'COMPLETED');
    assert.equal(recordedMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/test-session/master.m3u8');

    // 5.2 Test ERROR
    const resError = await handleJobStateChange({
      detail: {
        jobId: 'job-999',
        status: 'ERROR',
        errorMessage: 'Input file corrupted',
        userMetadata: {
          s3Key: 'videos/test-session.mp4',
          videoId: 'test-session',
        },
      },
    });

    assert.equal(resError.success, true);
    assert.equal(resError.status, 'FAILED');
    assert.equal(resError.error, 'Input file corrupted');
    assert.equal(recordedStatus, 'FAILED');
    assert.equal(recordedError, 'Input file corrupted');
  } finally {
    VideoConversion.findOneAndUpdate = origFindOneAndUpdate;
    Course.updateMany = origUpdateManyCourse;
    Recording.updateMany = origUpdateManyRec;
    VideoConversion.findOne = origFindOne;
  }
});

test('6. Webhook HTTP endpoint authenticates secret and delegates to handleJobStateChange', async () => {
  const origSecret = process.env.HLS_WEBHOOK_SECRET;
  process.env.HLS_WEBHOOK_SECRET = 'super-secret-token-123';

  const origFindOne = VideoConversion.findOne;
  const origFindOneAndUpdate = VideoConversion.findOneAndUpdate;

  VideoConversion.findOne = () => ({
    lean: async () => ({
      originalS3Key: 'videos/webhook.mp4',
      videoId: 'webhook-video',
      mediaConvertJobId: 'job-webhook-test',
    }),
  });
  VideoConversion.findOneAndUpdate = async (q, u) => ({ ...q, ...u.$set });

  try {
    // 6.1 Unauthorized attempt without secret returns 401
    const { req: badReq, res: badRes } = mockReqRes({
      headers: {},
      body: { detail: { jobId: '123' } },
    });
    await s3Controller.handleMediaConvertWebhook(badReq, badRes);
    assert.equal(badRes.statusCode, 401);
    assert.equal(badRes.responseBody.success, false);

    // 6.2 Authorized attempt with header returns 200
    const { req: goodReq, res: goodRes } = mockReqRes({
      headers: { 'x-webhook-secret': 'super-secret-token-123' },
      body: {
        detail: {
          jobId: 'job-webhook-test',
          status: 'COMPLETE',
          userMetadata: { videoId: 'webhook-video', s3Key: 'videos/webhook.mp4' },
        },
      },
    });
    await s3Controller.handleMediaConvertWebhook(goodReq, goodRes);
    assert.equal(goodRes.statusCode, 200);
    assert.equal(goodRes.responseBody.success, true);
  } finally {
    process.env.HLS_WEBHOOK_SECRET = origSecret;
    VideoConversion.findOne = origFindOne;
    VideoConversion.findOneAndUpdate = origFindOneAndUpdate;
  }
});

test('7. Playback API (getMediaAccessUrl) returns HLS master URL on COMPLETED, and fallback MP4 on PROCESSING/FAILED', async () => {
  const originalFindOneCourse = Course.findOne;
  const originalFindOneVC = VideoConversion.findOne;
  const originalSend = s3.s3Client.send;

  const mockCourse = {
    courseId: 'CRS-HLS-PLAYBACK',
    status: 'published',
    modules: [
      {
        lessons: [
          {
            lessonTitle: 'Playback Test Lesson',
            s3Key: 'videos/playback-test.mp4',
          },
        ],
      },
    ],
  };

  Course.findOne = () => {
    const p = Promise.resolve(mockCourse);
    p.lean = async () => mockCourse;
    return p;
  };

  s3.s3Client.send = async () => ({
    ContentLength: 1048576,
    ContentType: 'video/mp4',
  });

  try {
    // 7.1 Video is COMPLETED in VideoConversion
    VideoConversion.findOne = () => {
      const doc = {
        originalS3Key: 'videos/playback-test.mp4',
        videoId: 'playback-test',
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback-test/master.m3u8',
        hlsOutputPrefix: 'hls/playback-test/',
        mediaConvertJobId: 'job-comp-1',
      };
      const p = Promise.resolve(doc);
      p.lean = async () => doc;
      return p;
    };

    const { req: reqComp, res: resComp } = mockReqRes({
      query: { s3Key: 'videos/playback-test.mp4', courseId: 'CRS-HLS-PLAYBACK' },
      user: { role: 'admin' },
    });
    await s3Controller.getMediaAccessUrl(reqComp, resComp);

    assert.equal(resComp.statusCode, 200);
    assert.equal(resComp.responseBody.success, true);
    assert.equal(resComp.responseBody.playbackType, 'hls');
    assert.equal(resComp.responseBody.hlsConversionStatus, 'COMPLETED');
    assert.equal(resComp.responseBody.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback-test/master.m3u8');
    assert.match(resComp.responseBody.url, /X-Amz-Signature=/); // Original MP4 presigned fallback preserved!

    // 7.2 Video is PROCESSING in VideoConversion
    VideoConversion.findOne = () => {
      const doc = {
        originalS3Key: 'videos/playback-test.mp4',
        videoId: 'playback-test',
        hlsConversionStatus: 'PROCESSING',
        mediaConvertJobId: 'job-proc-2',
      };
      const p = Promise.resolve(doc);
      p.lean = async () => doc;
      return p;
    };

    const { req: reqProc, res: resProc } = mockReqRes({
      query: { s3Key: 'videos/playback-test.mp4', courseId: 'CRS-HLS-PLAYBACK' },
      user: { role: 'admin' },
    });
    await s3Controller.getMediaAccessUrl(reqProc, resProc);

    assert.equal(resProc.statusCode, 200);
    assert.equal(resProc.responseBody.hlsConversionStatus, 'PROCESSING');
    assert.equal(resProc.responseBody.playbackType, 'mp4');
    assert.equal(resProc.responseBody.hlsMasterUrl, '');
    assert.match(resProc.responseBody.url, /X-Amz-Signature=/); // MP4 playable during transcoding

    // 7.3 Video is FAILED in VideoConversion
    VideoConversion.findOne = () => {
      const doc = {
        originalS3Key: 'videos/playback-test.mp4',
        videoId: 'playback-test',
        hlsConversionStatus: 'FAILED',
        hlsConversionError: 'Transcoding timeout',
        mediaConvertJobId: 'job-fail-3',
      };
      const p = Promise.resolve(doc);
      p.lean = async () => doc;
      return p;
    };

    const { req: reqFail, res: resFail } = mockReqRes({
      query: { s3Key: 'videos/playback-test.mp4', courseId: 'CRS-HLS-PLAYBACK' },
      user: { role: 'admin' },
    });
    await s3Controller.getMediaAccessUrl(reqFail, resFail);

    assert.equal(resFail.statusCode, 200);
    assert.equal(resFail.responseBody.hlsConversionStatus, 'FAILED');
    assert.equal(resFail.responseBody.hlsConversionError, 'Transcoding timeout');
    assert.match(resFail.responseBody.url, /X-Amz-Signature=/); // MP4 fallback preserved
  } finally {
    Course.findOne = originalFindOneCourse;
    VideoConversion.findOne = originalFindOneVC;
    s3.s3Client.send = originalSend;
  }
});

test('8. Student curriculum attachVerifiedHlsStream attaches HLS URL when completed and falls back to MP4 when pending', async () => {
  const originalFindOneVC = VideoConversion.findOne;

  try {
    // 8.1 Completed HLS stream
    VideoConversion.findOne = () => ({
      lean: async () => ({
        originalS3Key: 'videos/student-video.mp4',
        videoId: 'student-video',
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/master.m3u8',
        hlsOutputPrefix: 'hls/student-video/',
      }),
    });

    const completedResource = await attachVerifiedHlsStream({
      storageProvider: 's3',
      s3Key: 'videos/student-video.mp4',
      url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/student-video.mp4?signed=true',
    });

    assert.equal(completedResource.hlsConversionStatus, 'COMPLETED');
    assert.equal(completedResource.playbackType, 'hls');
    assert.equal(completedResource.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/master.m3u8');
    assert.equal(completedResource.hlsPlaybackUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/master.m3u8');
    assert.match(completedResource.url, /signed=true/); // original MP4 preserved

    // 8.2 In-progress / Pending stream
    VideoConversion.findOne = () => ({
      lean: async () => ({
        originalS3Key: 'videos/student-video.mp4',
        videoId: 'student-video',
        hlsConversionStatus: 'PENDING',
      }),
    });

    const pendingResource = await attachVerifiedHlsStream({
      storageProvider: 's3',
      s3Key: 'videos/student-video.mp4',
      url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/student-video.mp4?signed=true',
    });

    assert.equal(pendingResource.hlsConversionStatus, 'PENDING');
    assert.equal(pendingResource.playbackType, 'mp4');
    assert.equal(pendingResource.hlsMasterUrl, '');
  } finally {
    VideoConversion.findOne = originalFindOneVC;
  }
});

test('9. Multipart complete upload returns HLS status PENDING and non-blocking job metadata', async () => {
  const originalSend = s3.s3Client.send;

  s3.s3Client.send = async (cmd) => {
    if (cmd.constructor?.name === 'CompleteMultipartUploadCommand') {
      return { Location: 'https://s3.amazonaws.com/bucket/videos/new-lecture.mp4', ETag: '"testetag"' };
    }
    if (cmd.constructor?.name === 'HeadObjectCommand') {
      return { ContentLength: 5000000, ContentType: 'video/mp4' };
    }
    return {};
  };

  try {
    const validKey = 'videos/1793873964171-38c7b73e-d7ef-4b4f-9014-f426b39c034e-new-lecture.mp4';
    const { req, res } = mockReqRes({
      body: {
        uploadId: 'upload-test-12345678',
        key: validKey,
        fileName: 'new-lecture.mp4',
        contentType: 'video/mp4',
        fileSize: 5000000,
        parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
      },
    });

    await s3Controller.completeMultipartUpload(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.responseBody.success, true);
    assert.equal(res.responseBody.hlsConversionStatus, 'PENDING');
    assert.equal(res.responseBody.hlsOutputPrefix, 'hls/1793873964171-38c7b73e-d7ef-4b4f-9014-f426b39c034e-new-lecture/');
    assert.equal(
      res.responseBody.hlsMasterUrl,
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/1793873964171-38c7b73e-d7ef-4b4f-9014-f426b39c034e-new-lecture/master.m3u8'
    );
    assert.equal(res.responseBody.media.hlsConversionStatus, 'PENDING');
  } finally {
    s3.s3Client.send = originalSend;
  }
});
