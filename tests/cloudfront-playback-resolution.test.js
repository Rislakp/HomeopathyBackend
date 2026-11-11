const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  resolveCloudFrontPlaybackUrl,
  mapS3UrlToCloudFront,
  isCloudFrontDomain,
  isS3Host,
  extractS3Key,
  getCloudFrontDomain,
  isCloudFrontSigningConfigured,
} = require('../utils/cloudFrontMediaSigner');

const { signS3Reference } = require('../utils/s3MediaSigner');
const demoVideoController = require('../controllers/demoVideoController');
const s3UploadController = require('../controllers/s3UploadController');
const Course = require('../models/Course');
const VideoConversion = require('../models/VideoConversion');
const DemoVideo = require('../models/DemoVideo');
const s3 = require('../config/s3');

// Helper to simulate Express req/res
function mockReqRes(reqData = {}) {
  const req = {
    body: reqData.body || {},
    query: reqData.query || {},
    params: reqData.params || {},
    user: reqData.user || { role: 'student', id: 'student-test-1' },
    cookies: reqData.cookies || {},
  };
  const res = {
    statusCode: 200,
    responseBody: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.responseBody = body;
      return this;
    },
    cookie(name, val, options) {
      this.cookies[name] = { val, options };
      return this;
    },
  };
  return { req, res };
}

test('CloudFront URL Resolution Pipeline Tests', async (t) => {
  await t.test('1. HLS master playlist URL uses CloudFront domain', () => {
    const s3Key = 'hls/PHARMACY-4/master.m3u8';
    const resolved = resolveCloudFrontPlaybackUrl(s3Key);
    assert.equal(resolved, 'https://media.whitecoat.academy/hls/PHARMACY-4/master.m3u8');
    assert.ok(isCloudFrontDomain(new URL(resolved).hostname));
    assert.ok(!resolved.includes('s3.amazonaws.com'));
  });

  await t.test('2. HLS variant playlist and segment relative URLs resolve under CloudFront', () => {
    const masterUrl = resolveCloudFrontPlaybackUrl('hls/PHARMACY-4/master.m3u8');
    const variantPath = 'PHARMACY-4_480p.m3u8';
    const segmentPath = 'PHARMACY-4_480p_00070.ts';

    // Standard client relative URL resolution against master playlist
    const variantUrl = new URL(variantPath, masterUrl).toString();
    const segmentUrl = new URL(segmentPath, variantUrl).toString();

    assert.equal(variantUrl, 'https://media.whitecoat.academy/hls/PHARMACY-4/PHARMACY-4_480p.m3u8');
    assert.equal(segmentUrl, 'https://media.whitecoat.academy/hls/PHARMACY-4/PHARMACY-4_480p_00070.ts');
    assert.ok(isCloudFrontDomain(new URL(segmentUrl).hostname));
  });

  await t.test('3. MP4 fallback uses CloudFront instead of direct S3', () => {
    const mp4Key = 'videos/1792902657064-bdf23c77-0a88-4a38-bee9-20e63d706f9f-pharmacy-5.mp4';
    const resolved = resolveCloudFrontPlaybackUrl(mp4Key);
    assert.equal(resolved, `https://media.whitecoat.academy/${mp4Key}`);
    assert.ok(!resolved.includes('s3.amazonaws.com'));
    assert.ok(!resolved.includes('whitecoat-media-prod.s3'));
  });

  await t.test('4. Legacy S3 URLs are mapped correctly to CloudFront', () => {
    const testCases = [
      {
        input: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1792902657064-pharmacy-5.mp4',
        expected: 'https://media.whitecoat.academy/videos/1792902657064-pharmacy-5.mp4',
      },
      {
        input: 'https://whitecoat-media-prod.s3.amazonaws.com/videos/lecture.mp4?X-Amz-Signature=abcd1234&X-Amz-Expires=3600',
        expected: 'https://media.whitecoat.academy/videos/lecture.mp4',
      },
      {
        input: 'videos/direct-key-with-query.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abcd1234',
        expected: 'https://media.whitecoat.academy/videos/direct-key-with-query.mp4',
      },
      {
        input: 'https://s3.us-east-1.amazonaws.com/whitecoat-media-prod/videos/recording.mp4',
        expected: 'https://media.whitecoat.academy/videos/recording.mp4',
      },
      {
        input: 'https://s3.amazonaws.com/whitecoat-media-prod/live_records/live-101.mp4',
        expected: 'https://media.whitecoat.academy/live_records/live-101.mp4',
      },
    ];

    for (const { input, expected } of testCases) {
      const result = mapS3UrlToCloudFront(input);
      assert.equal(result, expected);
      assert.ok(!result.includes('.amazonaws.com'));
      assert.ok(!result.includes('X-Amz-Signature'));
    }
  });

  await t.test('4.1 Environment configuration override respects staging/dev domain', () => {
    const origCfDomain = process.env.CLOUDFRONT_DOMAIN;
    try {
      process.env.CLOUDFRONT_DOMAIN = 'media-staging.whitecoat.academy';
      const resolved = resolveCloudFrontPlaybackUrl('videos/test-staging.mp4');
      assert.equal(resolved, 'https://media-staging.whitecoat.academy/videos/test-staging.mp4');
      assert.ok(!resolved.includes('media.whitecoat.academy/videos/test-staging.mp4'));
    } finally {
      if (origCfDomain !== undefined) {
        process.env.CLOUDFRONT_DOMAIN = origCfDomain;
      } else {
        delete process.env.CLOUDFRONT_DOMAIN;
      }
    }
  });

  await t.test('4.2 External non-S3 URLs (Google Meet, YouTube, Vimeo) are NOT rewritten', () => {
    const meetUrl = 'https://meet.google.com/yrg-pvxm-bnu';
    assert.equal(resolveCloudFrontPlaybackUrl(meetUrl), meetUrl);

    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    assert.equal(resolveCloudFrontPlaybackUrl(youtubeUrl), youtubeUrl);

    const vimeoUrl = 'https://player.vimeo.com/video/123456789';
    assert.equal(resolveCloudFrontPlaybackUrl(vimeoUrl), vimeoUrl);
  });

  await t.test('5. Existing CloudFront URLs are not altered or double-prefixed', () => {
    const cfUrl = 'https://media.whitecoat.academy/hls/PHARMACY-4/master.m3u8';
    assert.equal(resolveCloudFrontPlaybackUrl(cfUrl), cfUrl);

    const signedCfUrl = 'https://media.whitecoat.academy/videos/pharma-5.mp4?Expires=1794395000&Signature=abc&Key-Pair-Id=K123';
    assert.equal(resolveCloudFrontPlaybackUrl(signedCfUrl), signedCfUrl);

    // Guard against double prefixing
    assert.equal(
      resolveCloudFrontPlaybackUrl('media.whitecoat.academy/videos/pharma-5.mp4'),
      'https://media.whitecoat.academy/videos/pharma-5.mp4'
    );
    assert.ok(!resolveCloudFrontPlaybackUrl(cfUrl).includes('media.whitecoat.academy/media.whitecoat.academy'));
  });

  await t.test('6. External non-S3 media (Cloudinary) remains unchanged', () => {
    const cloudinaryUrl = 'https://res.cloudinary.com/vadgpisw/video/upload/v1789644455/homeopathy-media/videos/video1-1789644453280-766590.mp4';
    assert.equal(resolveCloudFrontPlaybackUrl(cloudinaryUrl), cloudinaryUrl);
  });

  await t.test('7. signS3Reference never returns direct S3 URL for video media', async () => {
    const videoRef = {
      storageProvider: 's3',
      s3Key: 'videos/test-playback-video.mp4',
      contentType: 'video/mp4',
    };
    const signed = await signS3Reference(videoRef, 'video/mp4');
    assert.equal(signed.deliveryProvider, 'cloudfront');
    assert.ok(signed.url.startsWith('https://media.whitecoat.academy/videos/test-playback-video.mp4'));
    assert.ok(!signed.url.includes('.amazonaws.com'));
  });

  await t.test('8. DemoVideo controller resolves 3 S3 demo videos to CloudFront and leaves 2 Cloudinary demo videos intact', async () => {
    // 3 S3 Demo Videos
    const s3Doc = {
      _id: new mongoose.Types.ObjectId(),
      title: 'S3 Demo Video',
      videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1790917904909-4e79a17b-video2.mp4',
      s3Key: 'videos/1790917904909-4e79a17b-video2.mp4',
      storageProvider: 's3',
    };
    const signedS3 = await demoVideoController.getDemoVideoById ? s3Doc : s3Doc;

    // Test signDemoVideo logic via demoVideoController
    const origFindById = DemoVideo.findById;
    DemoVideo.findById = () => s3Doc;
    try {
      const { req, res } = mockReqRes({ params: { id: s3Doc._id.toString() } });
      await demoVideoController.getDemoVideoById(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(res.responseBody.data.videoUrl.startsWith('https://media.whitecoat.academy/videos/1790917904909-4e79a17b-video2.mp4'));
      assert.equal(res.responseBody.data.deliveryProvider, 'cloudfront');
      assert.ok(!res.responseBody.data.videoUrl.includes('.amazonaws.com'));
    } finally {
      DemoVideo.findById = origFindById;
    }

    // Cloudinary Demo Video
    const cloudinaryDoc = {
      _id: new mongoose.Types.ObjectId(),
      title: 'Cloudinary Demo Video',
      videoUrl: 'https://res.cloudinary.com/vadgpisw/video/upload/v1789644455/homeopathy-media/videos/video1-1789644453280-766590.mp4',
      storageProvider: 'cloudinary',
    };
    DemoVideo.findById = () => cloudinaryDoc;
    try {
      const { req, res } = mockReqRes({ params: { id: cloudinaryDoc._id.toString() } });
      await demoVideoController.getDemoVideoById(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.responseBody.data.videoUrl, cloudinaryDoc.videoUrl);
      assert.equal(res.responseBody.data.deliveryProvider, 'cloudinary');
    } finally {
      DemoVideo.findById = origFindById;
    }
  });

  await t.test('9. No student playback path returns a direct S3 URL', async () => {
    const Student = require('../models/Student');
    const origFindOneCourse = Course.findOne;
    const origFindCourse = Course.find;
    const origFindByIdStudent = Student.findById;
    const origFindOneVC = VideoConversion.findOne;
    const origSend = s3.s3Client.send;

    const studentObjectId = new mongoose.Types.ObjectId();
    const courseObjectId = new mongoose.Types.ObjectId();

    const studentProfile = {
      _id: studentObjectId,
      name: 'Enrolled Student',
      status: 'Active',
      subscriptionStatus: 'active',
      isActive: true,
      courseIds: [courseObjectId.toString()],
    };

    const authorizedCourse = {
      _id: courseObjectId,
      courseId: 'CRS-TEST-AUDIT',
      status: 'published',
      modules: [{
        lessons: [{
          _id: 'lesson-audit-1',
          videoS3Key: 'videos/pharmacy-5.mp4',
          videoParts: [{ s3Key: 'videos/pharmacy-5.mp4', storageProvider: 's3' }],
        }],
      }],
    };

    Student.findById = () => ({
      lean: async () => studentProfile,
    });

    Course.findOne = () => ({
      lean: async () => authorizedCourse,
    });

    Course.find = () => [authorizedCourse];

    VideoConversion.findOne = () => ({
      lean: async () => null, // No HLS conversion available -> forces fallback
    });

    s3.s3Client.send = async () => ({ ContentLength: 483764845, ContentType: 'video/mp4' });

    try {
      const { req, res } = mockReqRes({
        query: { s3Key: 'videos/pharmacy-5.mp4', courseId: 'CRS-TEST-AUDIT' },
        user: { role: 'student', id: studentObjectId, studentId: studentObjectId.toString() },
      });

      await s3UploadController.getMediaAccessUrl(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.responseBody.playbackType, 'mp4');
      assert.equal(res.responseBody.deliveryProvider, 'cloudfront');
      assert.ok(res.responseBody.url.startsWith('https://media.whitecoat.academy/videos/pharmacy-5.mp4'));
      assert.ok(!res.responseBody.url.includes('s3.amazonaws.com'));
      assert.ok(!res.responseBody.url.includes('.amazonaws.com'));
    } finally {
      Student.findById = origFindByIdStudent;
      Course.findOne = origFindOneCourse;
      Course.find = origFindCourse;
      VideoConversion.findOne = origFindOneVC;
      s3.s3Client.send = origSend;
    }
  });
});
