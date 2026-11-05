const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

const s3 = require('../config/s3');
const { mediaConvertConfig } = require('../config/mediaconvert');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const DemoVideo = require('../models/DemoVideo');
const Student = require('../models/Student');

const {
  inFlightSubmissions,
  deriveVideoIdFromKey,
  isEligibleVideoKey,
  getCloudFrontHlsMasterUrl,
  buildHlsJobSettings,
  syncHlsDatabaseRecords,
  submitHlsConversionJob,
  enqueueHlsConversion,
  handleJobStateChange,
  getHlsConversionStatus,
} = require('../services/mediaConvertService');

const {
  generateHlsSignedCookies,
  attachHlsCookiesToResponse,
  generateHlsSignedUrl,
  isCloudFrontSigningConfigured,
  getKeyPairId,
  getCookieDomain,
} = require('../utils/cloudFrontSecurity');

const {
  attachVerifiedHlsStream,
  addSignedS3MediaUrls,
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
            hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/cardio.m3u8',
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
                hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/cardio.m3u8',
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
  assert.equal(les.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/cardio/cardio.m3u8');
  assert.equal(les.mediaConvertJobId, 'job-1001');

  const part = les.videoParts[0];
  assert.equal(part.hlsConversionStatus, 'COMPLETED');
  assert.equal(part.hlsOutputPrefix, 'hls/cardio/');
});

test('2. Recording, DemoVideo, and VideoConversion models validate HLS fields', () => {
  const rec = new Recording({
    s3Key: 'videos/live-rec.mp4',
    originalVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/live-rec.mp4',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/live-rec/live-rec.m3u8',
    hlsConversionStatus: 'PROCESSING',
    mediaConvertJobId: 'job-1002',
  });
  assert.equal(rec.validateSync(), undefined);
  assert.equal(rec.hlsConversionStatus, 'PROCESSING');

  const dv = new DemoVideo({
    title: 'Demo Cardiology',
    videoUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/demo-cardio.m3u8',
    courseId: 'CRS-DEMO-01',
    s3Key: 'videos/demo-cardio.mp4',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/demo-cardio.m3u8',
    hlsConversionStatus: 'COMPLETED',
  });
  assert.equal(dv.validateSync(), undefined);

  const vc = new VideoConversion({
    originalS3Key: 'videos/demo-cardio.mp4',
    videoId: 'demo-cardio',
    hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/demo-cardio/demo-cardio.m3u8',
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
    'https://d9rfsgqgwn1wa.cloudfront.net/hls/sample-123/sample-123.m3u8'
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
    assert.equal(resComplete.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/test-session/test-session.m3u8');
    assert.equal(recordedStatus, 'COMPLETED');
    assert.equal(recordedMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/test-session/test-session.m3u8');

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
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback-test/playback-test.m3u8',
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
    assert.equal(resComp.responseBody.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback-test/playback-test.m3u8');
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
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/student-video.m3u8',
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
    assert.equal(completedResource.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/student-video.m3u8');
    assert.equal(completedResource.hlsPlaybackUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/student-video/student-video.m3u8');
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
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/1793873964171-38c7b73e-d7ef-4b4f-9014-f426b39c034e-new-lecture/1793873964171-38c7b73e-d7ef-4b4f-9014-f426b39c034e-new-lecture.m3u8'
    );
    assert.equal(res.responseBody.media.hlsConversionStatus, 'PENDING');
  } finally {
    s3.s3Client.send = originalSend;
  }
});


test('10. Lesson-level curriculum response receives hlsMasterUrl and hlsConversionStatus from first eligible video part', async () => {
  const originalFindOneVC = VideoConversion.findOne;
  const originalSend = s3.s3Client.send;

  s3.s3Client.config.credentials = async () => ({ accessKeyId: 'LOCAL', secretAccessKey: 'local' });
  s3.s3Client.send = async () => ({ ContentLength: 2000000, ContentType: 'video/mp4' });

  VideoConversion.findOne = () => ({
    lean: async () => ({
      originalS3Key: 'videos/curriculum-hls.mp4',
      videoId: 'curriculum-hls',
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/curriculum-hls/curriculum-hls.m3u8',
      hlsOutputPrefix: 'hls/curriculum-hls/',
      mediaConvertJobId: 'job-curriculum-1',
    }),
  });

  try {
    const rawCourse = {
      _id: '6aab7f3954d18fda4f673a0d',
      courseId: 'CRS-CURRICULUM-TEST',
      status: 'published',
      modules: [
        {
          moduleName: 'Module 1',
          lessons: [
            {
              _id: 'les101',
              lessonTitle: 'HLS Mapping Lesson',
              s3Key: 'videos/curriculum-hls.mp4',
              videoParts: [
                {
                  title: 'Part 1',
                  storageProvider: 's3',
                  s3Key: 'videos/curriculum-hls.mp4',
                  m4vS3Key: 'videos/curriculum-hls_ios.m4v',
                  m4vStorageProvider: 's3',
                  m4vConversionStatus: 'completed',
                },
              ],
            },
          ],
        },
      ],
    };

    const formatted = await addSignedS3MediaUrls(rawCourse);
    const lesson = formatted.modules[0].lessons[0];

    // Assert lesson-level receives HLS fields from first eligible videoPart
    assert.equal(lesson.hlsConversionStatus, 'COMPLETED');
    assert.equal(lesson.playbackType, 'hls');
    assert.equal(
      lesson.hlsMasterUrl,
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/curriculum-hls/curriculum-hls.m3u8'
    );
    assert.equal(lesson.hlsOutputPrefix, 'hls/curriculum-hls/');
    assert.equal(lesson.mediaConvertJobId, 'job-curriculum-1');

    // Assert existing video parts have matching HLS fields
    const part = lesson.videoParts[0];
    assert.equal(part.hlsConversionStatus, 'COMPLETED');
    assert.equal(
      part.hlsMasterUrl,
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/curriculum-hls/curriculum-hls.m3u8'
    );

    // Assert MP4 and M4V fields are preserved
    assert.ok(lesson.videoUrl && lesson.videoUrl.includes('X-Amz-Signature='), 'Preserves videoUrl MP4 fallback');
    assert.ok(lesson.iosM4vUrl && lesson.iosM4vUrl.includes('X-Amz-Signature='), 'Preserves iosM4vUrl');
    assert.equal(lesson.m4vConversionStatus, 'completed');

    // Standalone lesson without videoParts also maps HLS
    const standaloneCourse = {
      _id: '6aab7f3954d18fda4f673a0e',
      courseId: 'CRS-STANDALONE-TEST',
      status: 'published',
      modules: [
        {
          moduleName: 'Module 1',
          lessons: [
            {
              _id: 'les102',
              lessonTitle: 'Standalone HLS Lesson',
              videoS3Key: 'videos/curriculum-hls.mp4',
              videoParts: [],
            },
          ],
        },
      ],
    };

    const formattedStandalone = await addSignedS3MediaUrls(standaloneCourse);
    const standaloneLesson = formattedStandalone.modules[0].lessons[0];
    assert.equal(standaloneLesson.hlsConversionStatus, 'COMPLETED');
    assert.equal(
      standaloneLesson.hlsMasterUrl,
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/curriculum-hls/curriculum-hls.m3u8'
    );
  } finally {
    VideoConversion.findOne = originalFindOneVC;
    s3.s3Client.send = originalSend;
  }
});


test('11. enqueueHlsConversion enforces synchronous duplicate-submission guard for concurrent calls', async () => {
  const testKey = 'videos/concurrent-dedup-test.mp4';
  inFlightSubmissions.delete(testKey);

  // Call 1: First call should enqueue and reserve lock immediately
  const call1 = enqueueHlsConversion(testKey);
  assert.equal(call1.enqueued, true);
  assert.equal(call1.status, 'PENDING');
  assert.equal(
    call1.hlsMasterUrl,
    'https://d9rfsgqgwn1wa.cloudfront.net/hls/concurrent-dedup-test/concurrent-dedup-test.m3u8'
  );
  assert.equal(inFlightSubmissions.has(testKey), true, 'Synchronous lock held immediately');

  // Call 2: Concurrent duplicate call before setImmediate executes
  const call2 = enqueueHlsConversion(testKey);
  assert.equal(call2.enqueued, false);
  assert.equal(call2.alreadyInFlight, true);
  assert.equal(call2.status, 'PENDING');

  // Allow setImmediate loop tick to complete and verify cleanup
  await new Promise((resolve) => setImmediate(resolve));
  const start = Date.now();
  while (inFlightSubmissions.has(testKey) && (Date.now() - start < 5000)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(inFlightSubmissions.has(testKey), false, 'In-flight lock cleaned up in finally block');
});


test('12. Fallback behavior: COMPLETED returns HLS, PROCESSING and FAILED return safe MP4 fallback', async () => {
  const origFindOneCourse = Course.findOne;
  const origFindOneVC = VideoConversion.findOne;
  const origSend = s3.s3Client.send;

  s3.s3Client.send = async () => ({ ContentLength: 2048000, ContentType: 'video/mp4' });
  Course.findOne = () => ({
    lean: async () => ({
      courseId: 'CRS-FALLBACK-TEST',
      status: 'published',
      modules: [{ lessons: [{ s3Key: 'videos/fallback-matrix.mp4' }] }],
    }),
  });

  try {
    // 12.1 COMPLETED: returns HLS master URL and signed cookies
    VideoConversion.findOne = () => ({
      lean: async () => ({
        originalS3Key: 'videos/fallback-matrix.mp4',
        videoId: 'fallback-matrix',
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/fallback-matrix/fallback-matrix.m3u8',
        hlsOutputPrefix: 'hls/fallback-matrix/',
      }),
    });

    const { req: rComp, res: sComp } = mockReqRes({
      query: { s3Key: 'videos/fallback-matrix.mp4', courseId: 'CRS-FALLBACK-TEST' },
    });
    await s3Controller.getMediaAccessUrl(rComp, sComp);
    assert.equal(sComp.statusCode, 200);
    assert.equal(sComp.responseBody.playbackType, 'hls');
    assert.equal(
      sComp.responseBody.hlsMasterUrl,
      'https://d9rfsgqgwn1wa.cloudfront.net/hls/fallback-matrix/fallback-matrix.m3u8'
    );
    assert.match(sComp.responseBody.url, /X-Amz-Signature=/, 'MP4 fallback preserved');

    // 12.2 PROCESSING: returns empty HLS URL and safe MP4 fallback
    VideoConversion.findOne = () => ({
      lean: async () => ({
        originalS3Key: 'videos/fallback-matrix.mp4',
        videoId: 'fallback-matrix',
        hlsConversionStatus: 'PROCESSING',
      }),
    });

    const { req: rProc, res: sProc } = mockReqRes({
      query: { s3Key: 'videos/fallback-matrix.mp4', courseId: 'CRS-FALLBACK-TEST' },
    });
    await s3Controller.getMediaAccessUrl(rProc, sProc);
    assert.equal(sProc.statusCode, 200);
    assert.equal(sProc.responseBody.playbackType, 'mp4');
    assert.equal(sProc.responseBody.hlsConversionStatus, 'PROCESSING');
    assert.equal(sProc.responseBody.hlsMasterUrl, '');
    assert.match(sProc.responseBody.url, /X-Amz-Signature=/);

    // 12.3 FAILED: returns empty HLS URL, error detail, and safe MP4 fallback
    VideoConversion.findOne = () => ({
      lean: async () => ({
        originalS3Key: 'videos/fallback-matrix.mp4',
        videoId: 'fallback-matrix',
        hlsConversionStatus: 'FAILED',
        hlsConversionError: 'Transcode failed: corrupt header',
      }),
    });

    const { req: rFail, res: sFail } = mockReqRes({
      query: { s3Key: 'videos/fallback-matrix.mp4', courseId: 'CRS-FALLBACK-TEST' },
    });
    await s3Controller.getMediaAccessUrl(rFail, sFail);
    assert.equal(sFail.statusCode, 200);
    assert.equal(sFail.responseBody.playbackType, 'mp4');
    assert.equal(sFail.responseBody.hlsConversionStatus, 'FAILED');
    assert.equal(sFail.responseBody.hlsConversionError, 'Transcode failed: corrupt header');
    assert.equal(sFail.responseBody.hlsMasterUrl, '');
    assert.match(sFail.responseBody.url, /X-Amz-Signature=/);
  } finally {
    Course.findOne = origFindOneCourse;
    VideoConversion.findOne = origFindOneVC;
    s3.s3Client.send = origSend;
  }
});

test('13. CloudFront Signed Cookies: Custom wildcard policy signing generates CloudFront-Policy, CloudFront-Signature, and CloudFront-Key-Pair-Id', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  process.env.CLOUDFRONT_KEY_PAIR_ID = 'KTESTSIGNER01';
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;

  try {
    const videoId = 'lecture-cardio-99';
    const ttlSeconds = 3600;
    const cookies = generateHlsSignedCookies(videoId, ttlSeconds);

    assert.ok(cookies, 'Signed cookies object should be returned');
    assert.equal(cookies['CloudFront-Key-Pair-Id'], 'KTESTSIGNER01');
    assert.ok(typeof cookies['CloudFront-Signature'] === 'string' && cookies['CloudFront-Signature'].length > 0);
    assert.ok(typeof cookies['CloudFront-Policy'] === 'string' && cookies['CloudFront-Policy'].length > 0);

    // Decode and verify CloudFront custom policy JSON
    const b64 = cookies['CloudFront-Policy'].replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
    const policyJson = Buffer.from(b64, 'base64').toString('utf8');
    const policy = JSON.parse(policyJson);

    assert.ok(Array.isArray(policy.Statement) && policy.Statement.length === 1);
    const statement = policy.Statement[0];
    assert.equal(statement.Resource, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/lecture-cardio-99/*');
    assert.ok(statement.Condition && statement.Condition.DateLessThan);
    const epochTime = statement.Condition.DateLessThan['AWS:EpochTime'];
    const nowEpoch = Math.floor(Date.now() / 1000);
    assert.ok(epochTime >= nowEpoch + 3500 && epochTime <= nowEpoch + 3700, 'Epoch expiration within expected TTL window');
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PRIVATE_KEY = origPrivateKey;
  }
});

test('14. Key ID fallback configuration: CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PUBLIC_KEY_ID, and CLOUDFRONT_KEY_ID', () => {
  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPublicKeyId = process.env.CLOUDFRONT_PUBLIC_KEY_ID;
  const origKeyId = process.env.CLOUDFRONT_KEY_ID;
  const origCfgKeyPairId = mediaConvertConfig.cloudFrontKeyPairId;

  try {
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PUBLIC_KEY_ID;
    delete process.env.CLOUDFRONT_KEY_ID;
    mediaConvertConfig.cloudFrontKeyPairId = '';

    // Test fallback to CLOUDFRONT_KEY_ID
    process.env.CLOUDFRONT_KEY_ID = 'KID-ONLY-999';
    assert.equal(getKeyPairId(), 'KID-ONLY-999');

    // Test CLOUDFRONT_PUBLIC_KEY_ID takes precedence over CLOUDFRONT_KEY_ID
    process.env.CLOUDFRONT_PUBLIC_KEY_ID = 'KPUB-PRECEDENCE-888';
    assert.equal(getKeyPairId(), 'KPUB-PRECEDENCE-888');

    // Test CLOUDFRONT_KEY_PAIR_ID takes highest precedence
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'KPAIR-TOP-777';
    assert.equal(getKeyPairId(), 'KPAIR-TOP-777');
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PUBLIC_KEY_ID = origPublicKeyId;
    process.env.CLOUDFRONT_KEY_ID = origKeyId;
    mediaConvertConfig.cloudFrontKeyPairId = origCfgKeyPairId;
  }
});

test('15. Cookie security attributes and CLOUDFRONT_COOKIE_DOMAIN configuration support', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const origCookieDomain = process.env.CLOUDFRONT_COOKIE_DOMAIN;
  const origCfgCookieDomain = mediaConvertConfig.cookieDomain;

  process.env.CLOUDFRONT_KEY_PAIR_ID = 'KTESTKEY123';
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;
  delete process.env.CLOUDFRONT_COOKIE_DOMAIN;
  mediaConvertConfig.cookieDomain = '';

  try {
    // 15.1 Without CLOUDFRONT_COOKIE_DOMAIN: host-only cookies (domain undefined)
    const resHostOnly = {
      cookies: {},
      cookie(name, val, options) {
        this.cookies[name] = { val, options };
      },
    };

    const successHost = attachHlsCookiesToResponse(resHostOnly, 'session-vid-1', 7200);
    assert.equal(successHost, true);

    const expectedCookies = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature'];
    for (const cookieName of expectedCookies) {
      assert.ok(resHostOnly.cookies[cookieName], `Cookie ${cookieName} must be attached`);
      const { options } = resHostOnly.cookies[cookieName];
      assert.equal(options.httpOnly, true, 'Must have httpOnly: true');
      assert.equal(options.secure, true, 'Must have secure: true');
      assert.equal(options.sameSite, 'None', 'Must have sameSite: "None"');
      assert.equal(options.path, '/', 'Must have path: "/"');
      assert.equal(options.maxAge, 7200 * 1000, 'Must have correct maxAge in ms');
      assert.equal(options.domain, undefined, 'Host-only cookie has no domain attribute');
    }

    // 15.2 With CLOUDFRONT_COOKIE_DOMAIN: domain attribute is set
    process.env.CLOUDFRONT_COOKIE_DOMAIN = '.whitecoat.academy';
    const resWithDomain = {
      cookies: {},
      cookie(name, val, options) {
        this.cookies[name] = { val, options };
      },
    };

    const successDomain = attachHlsCookiesToResponse(resWithDomain, 'session-vid-1', 7200);
    assert.equal(successDomain, true);

    for (const cookieName of expectedCookies) {
      assert.ok(resWithDomain.cookies[cookieName]);
      const { options } = resWithDomain.cookies[cookieName];
      assert.equal(options.domain, '.whitecoat.academy', 'Cookie domain attribute must match CLOUDFRONT_COOKIE_DOMAIN');
      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, 'None');
      assert.equal(options.path, '/');
    }
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PRIVATE_KEY = origPrivateKey;
    process.env.CLOUDFRONT_COOKIE_DOMAIN = origCookieDomain;
    mediaConvertConfig.cookieDomain = origCfgCookieDomain;
  }
});

test('16. Graceful degradation on missing CloudFront credentials', () => {
  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPublicKeyId = process.env.CLOUDFRONT_PUBLIC_KEY_ID;
  const origKeyId = process.env.CLOUDFRONT_KEY_ID;
  const origPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const origCfgKeyPairId = mediaConvertConfig.cloudFrontKeyPairId;
  const origCfgPrivateKey = mediaConvertConfig.cloudFrontPrivateKey;

  try {
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PUBLIC_KEY_ID;
    delete process.env.CLOUDFRONT_KEY_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    mediaConvertConfig.cloudFrontKeyPairId = '';
    mediaConvertConfig.cloudFrontPrivateKey = '';

    assert.equal(isCloudFrontSigningConfigured(), false);
    assert.equal(generateHlsSignedCookies('missing-creds-vid'), null);

    const res = { cookies: {}, cookie() {} };
    assert.equal(attachHlsCookiesToResponse(res, 'missing-creds-vid'), false);

    const unsignedUrl = 'https://d9rfsgqgwn1wa.cloudfront.net/hls/vid/vid.m3u8';
    assert.equal(generateHlsSignedUrl(unsignedUrl), unsignedUrl);
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PUBLIC_KEY_ID = origPublicKeyId;
    process.env.CLOUDFRONT_KEY_ID = origKeyId;
    process.env.CLOUDFRONT_PRIVATE_KEY = origPrivateKey;
    mediaConvertConfig.cloudFrontKeyPairId = origCfgKeyPairId;
    mediaConvertConfig.cloudFrontPrivateKey = origCfgPrivateKey;
  }
});

test('17. Error handling with corrupted / invalid private key', () => {
  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const origCfgKeyPairId = mediaConvertConfig.cloudFrontKeyPairId;
  const origCfgPrivateKey = mediaConvertConfig.cloudFrontPrivateKey;

  try {
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'KTESTKEY123';
    process.env.CLOUDFRONT_PRIVATE_KEY = 'invalid-pem-not-an-rsa-key';
    mediaConvertConfig.cloudFrontKeyPairId = 'KTESTKEY123';
    mediaConvertConfig.cloudFrontPrivateKey = 'invalid-pem-not-an-rsa-key';

    assert.equal(isCloudFrontSigningConfigured(), true);
    assert.equal(generateHlsSignedCookies('invalid-key-vid'), null);

    const res = { cookies: {}, cookie() {} };
    assert.equal(attachHlsCookiesToResponse(res, 'invalid-key-vid'), false);

    const unsignedUrl = 'https://d9rfsgqgwn1wa.cloudfront.net/hls/vid/vid.m3u8';
    assert.equal(generateHlsSignedUrl(unsignedUrl), unsignedUrl);
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PRIVATE_KEY = origPrivateKey;
    mediaConvertConfig.cloudFrontKeyPairId = origCfgKeyPairId;
    mediaConvertConfig.cloudFrontPrivateKey = origCfgPrivateKey;
  }
});

test('18. getMediaAccessUrl attaches CloudFront signed cookies when signing is configured and status is COMPLETED', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const origKeyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const origFindOneCourse = Course.findOne;
  const origFindOneVC = VideoConversion.findOne;
  const origSend = s3.s3Client.send;

  process.env.CLOUDFRONT_KEY_PAIR_ID = 'KTESTSIGNER02';
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;

  s3.s3Client.send = async () => ({ ContentLength: 2048000, ContentType: 'video/mp4' });
  Course.findOne = () => ({
    lean: async () => ({
      courseId: 'CRS-COOKIE-TEST',
      status: 'published',
      modules: [{ lessons: [{ s3Key: 'videos/signed-cookies-stream.mp4' }] }],
    }),
  });

  VideoConversion.findOne = () => ({
    lean: async () => ({
      originalS3Key: 'videos/signed-cookies-stream.mp4',
      videoId: 'signed-cookies-stream',
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/signed-cookies-stream/signed-cookies-stream.m3u8',
      hlsOutputPrefix: 'hls/signed-cookies-stream/',
    }),
  });

  try {
    const { req, res } = mockReqRes({
      query: { s3Key: 'videos/signed-cookies-stream.mp4', courseId: 'CRS-COOKIE-TEST' },
      user: { role: 'admin' },
    });

    await s3Controller.getMediaAccessUrl(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.responseBody.playbackType, 'hls');
    assert.ok(res.cookies['CloudFront-Key-Pair-Id'], 'CloudFront-Key-Pair-Id cookie attached to response');
    assert.ok(res.cookies['CloudFront-Policy'], 'CloudFront-Policy cookie attached to response');
    assert.ok(res.cookies['CloudFront-Signature'], 'CloudFront-Signature cookie attached to response');
    assert.equal(res.cookies['CloudFront-Policy'].options.httpOnly, true);
    assert.equal(res.cookies['CloudFront-Policy'].options.secure, true);
    assert.equal(res.cookies['CloudFront-Policy'].options.sameSite, 'None');
    assert.equal(res.cookies['CloudFront-Policy'].options.path, '/');
    assert.match(res.responseBody.url, /X-Amz-Signature=/, 'Preserves MP4 fallback URL');
  } finally {
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPairId;
    process.env.CLOUDFRONT_PRIVATE_KEY = origPrivateKey;
    Course.findOne = origFindOneCourse;
    VideoConversion.findOne = origFindOneVC;
    s3.s3Client.send = origSend;
  }
});
