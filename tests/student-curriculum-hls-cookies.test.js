const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mediaConvertConfig } = require('../config/mediaconvert');
const { s3Client } = require('../config/s3');
const Course = require('../models/Course');
const Student = require('../models/Student');
const CourseProgress = require('../models/CourseProgress');
const ContentItemProgress = require('../models/ContentItemProgress');
const VideoConversion = require('../models/VideoConversion');
const {
  attachHlsCookiesToResponse,
  generateHlsSignedCookies,
  generateHlsSignedUrl,
  DEFAULT_TTL_SECONDS,
  getValidatedHlsMasterUrl,
} = require('../utils/cloudFrontSecurity');
const {
  attachCurriculumHlsCookies,
  collectCurriculumHlsVideoIds,
  getMyCourses,
} = require('../controllers/studentCurriculumController');
const { clearUnverifiedCloudFrontHlsUrls } = require('../utils/studentCurriculumHls');

const COOKIE_NAMES = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature'];

function decodePolicy(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

function cookieResponse() {
  return {
    cookies: {},
    cookie(name, value, options) {
      this.cookies[name] = { value, options };
      return this;
    },
  };
}

function withSigningConfig(t) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const env = {
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: process.env.CLOUDFRONT_PRIVATE_KEY,
    cookieDomain: process.env.CLOUDFRONT_COOKIE_DOMAIN,
  };
  const config = {
    keyPairId: mediaConvertConfig.cloudFrontKeyPairId,
    privateKey: mediaConvertConfig.cloudFrontPrivateKey,
    cookieDomain: mediaConvertConfig.cookieDomain,
  };
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K1XNYI3JNPWK0P';
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;
  process.env.CLOUDFRONT_COOKIE_DOMAIN = '.whitecoat.academy';
  mediaConvertConfig.cloudFrontKeyPairId = '';
  mediaConvertConfig.cloudFrontPrivateKey = '';
  mediaConvertConfig.cookieDomain = '';
  t.after(() => {
    if (env.keyPairId === undefined) delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    else process.env.CLOUDFRONT_KEY_PAIR_ID = env.keyPairId;
    if (env.privateKey === undefined) delete process.env.CLOUDFRONT_PRIVATE_KEY;
    else process.env.CLOUDFRONT_PRIVATE_KEY = env.privateKey;
    if (env.cookieDomain === undefined) delete process.env.CLOUDFRONT_COOKIE_DOMAIN;
    else process.env.CLOUDFRONT_COOKIE_DOMAIN = env.cookieDomain;
    mediaConvertConfig.cloudFrontKeyPairId = config.keyPairId;
    mediaConvertConfig.cloudFrontPrivateKey = config.privateKey;
    mediaConvertConfig.cookieDomain = config.cookieDomain;
  });
}

test('curriculum HLS cookies authorize only the returned videos and all child playlist/segment paths', (t) => {
  withSigningConfig(t);
  const curriculum = {
    modules: [{ lessons: [{
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
      hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
      videoParts: [{
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-2/cardio-2.m3u8',
        hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-2/cardio-2.m3u8',
      }],
    }] }],
  };
  const res = cookieResponse();

  assert.deepEqual([...collectCurriculumHlsVideoIds(curriculum)].sort(), ['cardio-1', 'cardio-2']);
  assert.equal(attachCurriculumHlsCookies(res, curriculum), true);
  assert.deepEqual(Object.keys(res.cookies).sort(), [...COOKIE_NAMES].sort());

  const policy = decodePolicy(res.cookies['CloudFront-Policy'].value);
  assert.deepEqual(policy.Statement.map((statement) => statement.Resource).sort(), [
    'https://media.whitecoat.academy/hls/cardio-1/*',
    'https://media.whitecoat.academy/hls/cardio-2/*',
  ]);
  assert.ok(policy.Statement.every((statement) => statement.Condition.DateLessThan['AWS:EpochTime'] > Math.floor(Date.now() / 1000)));
  for (const cookieName of COOKIE_NAMES) {
    const options = res.cookies[cookieName].options;
    assert.equal(options.domain, '.whitecoat.academy');
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'None');
    assert.equal(options.path, '/');
  }
});

test('student curriculum selects each verified HLS URL over its signed S3 fallback and updates lesson videoUrl', (t) => {
  withSigningConfig(t);
  const firstHls = 'https://media.whitecoat.academy/hls/part-one/master.m3u8';
  const secondHls = 'https://media.whitecoat.academy/hls/part-two/master-list.m3u8';
  const s3Fallback = 'https://whitecoat-media-prod.s3.amazonaws.com/videos/source.mp4?X-Amz-Signature=local-test';
  const curriculum = {
    modules: [{ lessons: [{
      videoUrl: s3Fallback,
      videoParts: [
        {
          storageProvider: 's3',
          s3Key: 'videos/part-one.mp4',
          url: s3Fallback,
          hlsConversionStatus: 'COMPLETED',
          playbackType: 'hls',
          hlsMasterUrl: firstHls,
          hlsPlaybackUrl: firstHls,
        },
        {
          storageProvider: 's3',
          s3Key: 'videos/part-two.mp4',
          url: s3Fallback,
          hlsConversionStatus: 'COMPLETED',
          playbackType: 'hls',
          hlsMasterUrl: secondHls,
          hlsPlaybackUrl: secondHls,
        },
      ],
    }] }],
  };

  assert.equal(attachCurriculumHlsCookies(cookieResponse(), curriculum), true);
  const [first, second] = curriculum.modules[0].lessons[0].videoParts;
  assert.equal(first.url, firstHls);
  assert.equal(first.secure_url, firstHls);
  assert.equal(first.fileUrl, firstHls);
  assert.equal(second.url, secondHls);
  assert.equal(second.path, secondHls);
  assert.equal(curriculum.modules[0].lessons[0].videoUrl, firstHls);
});

test('Cloudinary lesson video URLs remain unchanged by HLS selection', (t) => {
  withSigningConfig(t);
  const cloudinaryUrl = 'https://res.cloudinary.com/example/video/upload/lesson.mp4';
  const curriculum = {
    modules: [{ lessons: [{
      videoUrl: cloudinaryUrl,
      videoParts: [{ storageProvider: 'cloudinary', url: cloudinaryUrl }],
    }] }],
  };

  assert.equal(attachCurriculumHlsCookies(cookieResponse(), curriculum), true);
  assert.equal(curriculum.modules[0].lessons[0].videoUrl, cloudinaryUrl);
  assert.equal(curriculum.modules[0].lessons[0].videoParts[0].url, cloudinaryUrl);
});

test('unverified direct CloudFront HLS URLs without a source key are removed from every lesson and video-part URL alias', () => {
  const curriculum = { modules: [{ lessons: [{
    videoUrl: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
    url: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
    videoParts: [{
      url: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      secure_url: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      secureUrl: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      fileUrl: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      documentUrl: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      path: 'https://media.whitecoat.academy/hls/legacy/master.m3u8',
      // An authorized MP4 fallback remains available if one was supplied.
      mp4FallbackUrl: 'https://whitecoat-media-prod.s3.amazonaws.com/videos/legacy.mp4?X-Amz-Signature=test',
    }],
  }] }] };

  assert.equal(attachCurriculumHlsCookies(cookieResponse(), curriculum), true);
  const lesson = curriculum.modules[0].lessons[0];
  assert.equal(lesson.videoUrl, '');
  assert.equal(lesson.url, '');
  for (const field of ['url', 'secure_url', 'secureUrl', 'fileUrl', 'documentUrl', 'path']) {
    assert.equal(lesson.videoParts[0][field], '');
  }
  assert.match(lesson.videoParts[0].mp4FallbackUrl, /videos\/legacy\.mp4/);
});

test('direct third-party legacy HLS resources and Cloudinary dummy records are unaffected', () => {
  const cloudinaryUrl = 'https://res.cloudinary.com/example/video/upload/dummy.m3u8';
  const unrelatedLegacyUrl = 'https://legacy.example.org/course/lesson.m3u8';
  const curriculum = { modules: [{ lessons: [{
    videoUrl: cloudinaryUrl,
    videoParts: [
      { storageProvider: 'cloudinary', url: cloudinaryUrl },
      { url: unrelatedLegacyUrl },
    ],
  }] }] };

  clearUnverifiedCloudFrontHlsUrls(curriculum);
  assert.equal(curriculum.modules[0].lessons[0].videoUrl, cloudinaryUrl);
  assert.equal(curriculum.modules[0].lessons[0].videoParts[0].url, cloudinaryUrl);
  assert.equal(curriculum.modules[0].lessons[0].videoParts[1].url, unrelatedLegacyUrl);
});

test('missing signing configuration or an invalid response cannot return an unsigned HLS URL', (t) => {
  withSigningConfig(t);
  const oldKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const oldConfiguredKey = mediaConvertConfig.cloudFrontPrivateKey;
  delete process.env.CLOUDFRONT_PRIVATE_KEY;
  mediaConvertConfig.cloudFrontPrivateKey = '';

  const curriculum = {
    hlsConversionStatus: 'COMPLETED',
    hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
    hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
    playbackType: 'hls',
    url: 'https://authorized.example/video.mp4?signature=local-test',
    modules: [{ lessons: [{
      videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/fallback.mp4?X-Amz-Signature=local-test',
      playbackType: 'hls',
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://media.whitecoat.academy/hls/fallback/fallback.m3u8',
      videoParts: [{
        storageProvider: 's3',
        s3Key: 'videos/fallback.mp4',
        url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/fallback.mp4?X-Amz-Signature=local-test',
        playbackType: 'hls',
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://media.whitecoat.academy/hls/fallback/fallback.m3u8',
        hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/fallback/fallback.m3u8',
      }],
    }] }],
  };
  const res = cookieResponse();

  assert.throws(() => attachHlsCookiesToResponse(res, 'cardio-1'), /not configured/i);
  assert.equal(attachCurriculumHlsCookies(res, curriculum), false);
  assert.equal(curriculum.hlsMasterUrl, '');
  assert.equal(curriculum.hlsPlaybackUrl, '');
  assert.equal(curriculum.playbackType, 'mp4');
  assert.match(curriculum.url, /video\.mp4/);
  assert.equal(curriculum.modules[0].lessons[0].hlsMasterUrl, '');
  assert.equal(curriculum.modules[0].lessons[0].videoParts[0].hlsMasterUrl, '');
  assert.match(curriculum.modules[0].lessons[0].videoParts[0].url, /X-Amz-Signature=local-test/);
  assert.match(curriculum.modules[0].lessons[0].videoUrl, /X-Amz-Signature=local-test/);
  assert.deepEqual(res.cookies, {});

  process.env.CLOUDFRONT_PRIVATE_KEY = oldKey;
  mediaConvertConfig.cloudFrontPrivateKey = oldConfiguredKey;
});

test('custom policy generation rejects invalid video identifiers and master-only signed URLs', () => {
  assert.throws(() => generateHlsSignedCookies(['valid-id', '../other']), /invalid HLS video identifier/i);
  assert.throws(() => generateHlsSignedUrl('https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8'), /signed cookies/i);
});

test('CloudFront cookies default to the one-day maximum and can be renewed with secure attributes intact', (t) => {
  withSigningConfig(t);
  assert.equal(DEFAULT_TTL_SECONDS, 86400);
  const res = cookieResponse();
  const start = Math.floor(Date.now() / 1000);
  attachHlsCookiesToResponse(res, 'cardio-1', 7200);
  const firstExpiry = decodePolicy(res.cookies['CloudFront-Policy'].value).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
  attachHlsCookiesToResponse(res, 'cardio-1', 7200);
  const refreshedExpiry = decodePolicy(res.cookies['CloudFront-Policy'].value).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
  assert.ok(firstExpiry >= start + 7199 && firstExpiry <= start + 7201);
  assert.ok(refreshedExpiry >= firstExpiry);
  for (const cookieName of COOKIE_NAMES) {
    const options = res.cookies[cookieName].options;
    assert.equal(options.domain, '.whitecoat.academy');
    assert.equal(options.path, '/');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'None');
  }
});

test('persisted nonstandard master playlist filename is preserved and unsafe URLs are rejected', () => {
  assert.equal(
    getValidatedHlsMasterUrl('https://media.whitecoat.academy/hls/cardio-1/master-list.m3u8', 'cardio-1'),
    'https://media.whitecoat.academy/hls/cardio-1/master-list.m3u8',
  );
  assert.throws(() => getValidatedHlsMasterUrl('https://evil.example/hls/cardio-1/master-list.m3u8', 'cardio-1'), /invalid HLS master/i);
  assert.throws(() => getValidatedHlsMasterUrl('https://media.whitecoat.academy/hls/other/master-list.m3u8', 'cardio-1'), /invalid HLS master/i);
});

test('HLS master validator rejects empty, malformed, non-HTTPS, and untrusted URLs', () => {
  for (const url of ['', 'not a URL', 'http://media.whitecoat.academy/hls/cardio-1/master.m3u8',
    'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/hls/cardio-1/master.m3u8',
    'https://evil.example/hls/cardio-1/master.m3u8']) {
    assert.throws(() => getValidatedHlsMasterUrl(url, 'cardio-1'), /invalid HLS master/i, `reject ${url || '(empty)'}`);
  }
});

test('HLS master validator preserves query parameters and allows only explicitly configured alternate hosts', (t) => {
  const original = process.env.CLOUDFRONT_TRUSTED_HLS_DOMAINS;
  process.env.CLOUDFRONT_TRUSTED_HLS_DOMAINS = 'hls-alt.whitecoat.academy';
  t.after(() => {
    if (original === undefined) delete process.env.CLOUDFRONT_TRUSTED_HLS_DOMAINS;
    else process.env.CLOUDFRONT_TRUSTED_HLS_DOMAINS = original;
  });

  const canonical = 'https://media.whitecoat.academy/hls/cardio-1/master.m3u8?version=2&token=fixture';
  assert.equal(getValidatedHlsMasterUrl(canonical, 'cardio-1'), canonical);
  assert.equal(
    getValidatedHlsMasterUrl('https://hls-alt.whitecoat.academy/hls/cardio-1/actual-master.m3u8?variant=main', 'cardio-1'),
    'https://hls-alt.whitecoat.academy/hls/cardio-1/actual-master.m3u8?variant=main',
  );
  assert.throws(() => getValidatedHlsMasterUrl('https://other.whitecoat.academy/hls/cardio-1/master.m3u8', 'cardio-1'), /invalid HLS master/i);

  withSigningConfig(t);
  const res = cookieResponse();
  attachHlsCookiesToResponse(res, 'cardio-1');
  const policy = decodePolicy(res.cookies['CloudFront-Policy'].value);
  assert.deepEqual(policy.Statement.map((statement) => statement.Resource).sort(), [
    'https://hls-alt.whitecoat.academy/hls/cardio-1/*',
    'https://media.whitecoat.academy/hls/cardio-1/*',
  ]);
});

test('GET /api/student/courses stays successful when one video has an invalid conversion URL', async (t) => {
  withSigningConfig(t);
  const originals = {
    courseFind: Course.find,
    studentFindOne: Student.findOne,
    conversionFindOne: VideoConversion.findOne,
    progressFind: ContentItemProgress.find,
    courseProgressFindOne: CourseProgress.findOne,
    s3Credentials: s3Client.config.credentials,
  };
  t.after(() => {
    Course.find = originals.courseFind;
    Student.findOne = originals.studentFindOne;
    VideoConversion.findOne = originals.conversionFindOne;
    ContentItemProgress.find = originals.progressFind;
    CourseProgress.findOne = originals.courseProgressFindOne;
    s3Client.config.credentials = originals.s3Credentials;
  });

  const courseDocument = {
    _id: 'course-object-id',
    courseId: 'COURSE-HLS-RESILIENCE',
    courseTitle: 'HLS resilience course',
    status: 'Published',
    modules: [{ moduleName: 'Module 1', lessons: [
      {
        _id: 'lesson-bad',
        lessonTitle: 'Invalid persisted HLS URL',
        videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/bad-master.mp4',
        videoParts: [{
          storageProvider: 's3',
          s3Key: 'videos/bad-master.mp4',
          url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/bad-master.mp4',
        }],
      },
      {
        _id: 'lesson-good',
        lessonTitle: 'Valid HLS URL',
        videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/good-master.mp4',
        videoParts: [{
          storageProvider: 's3',
          s3Key: 'videos/good-master.mp4',
          url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/good-master.mp4',
        }],
      },
    ] }],
    toObject() {
      return {
        _id: this._id,
        courseId: this.courseId,
        courseTitle: this.courseTitle,
        status: this.status,
        modules: this.modules,
      };
    },
  };

  Student.findOne = async (query) => query.email
    ? { _id: 'student-id', courseId: 'COURSE-HLS-RESILIENCE', course: 'HLS resilience course' }
    : null;
  Course.find = async () => [courseDocument];
  ContentItemProgress.find = () => ({ lean: async () => [] });
  CourseProgress.findOne = () => ({ lean: async () => null });
  s3Client.config.credentials = async () => ({ accessKeyId: 'LOCALTEST', secretAccessKey: 'local-test-only' });
  const records = {
    'videos/bad-master.mp4': {
      _id: 'conversion-bad',
      originalS3Key: 'videos/bad-master.mp4',
      videoId: 'bad-master',
      mediaConvertJobId: 'job-bad-master',
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://untrusted.example/hls/bad-master/master.m3u8?token=should-not-log',
    },
    'videos/good-master.mp4': {
      _id: 'conversion-good',
      originalS3Key: 'videos/good-master.mp4',
      videoId: 'good-master',
      mediaConvertJobId: 'job-good-master',
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://media.whitecoat.academy/hls/good-master/master.m3u8?version=2',
    },
  };
  VideoConversion.findOne = ({ originalS3Key }) => ({ lean: async () => records[originalS3Key] || null });

  const res = cookieResponse();
  res.statusCode = 200;
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (body) { this.body = body; return this; };

  await getMyCourses({ user: { role: 'student', email: 'student@example.test' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  const lessons = res.body.data[0].modules[0].lessons;
  const invalid = lessons[0].videoParts[0];
  const valid = lessons[1].videoParts[0];
  assert.equal(invalid.hlsConversionStatus, 'FAILED');
  assert.equal(invalid.hlsMasterUrl, '');
  assert.equal(invalid.playbackType, 'mp4');
  assert.match(invalid.url, /X-Amz-Signature=/);
  assert.equal(valid.hlsConversionStatus, 'COMPLETED');
  assert.equal(valid.playbackType, 'hls');
  assert.equal(valid.url, 'https://media.whitecoat.academy/hls/good-master/master.m3u8?version=2');
  assert.ok(res.cookies['CloudFront-Policy']);
});
