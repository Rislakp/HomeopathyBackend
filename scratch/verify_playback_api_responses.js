const assert = require('assert');
const s3Controller = require('../controllers/s3UploadController');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');
const s3 = require('../config/s3');
const Course = require('../models/Course');
const VideoConversion = require('../models/VideoConversion');

function mockReqRes(data = {}) {
  const req = {
    query: data.query || {},
    params: data.params || {},
    body: data.body || {},
    user: data.user || { role: 'admin' },
    headers: {},
  };
  const res = {
    statusCode: 200,
    cookies: {},
    responseBody: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.responseBody = data; return this; },
    cookie(name, val, opts) { this.cookies[name] = { val, opts }; return this; },
  };
  return { req, res };
}

async function run() {
  const origFindOneCourse = Course.findOne;
  const origFindOneVC = VideoConversion.findOne;
  const origSend = s3.s3Client.send;

  s3.s3Client.config.credentials = async () => ({ accessKeyId: 'LOCAL', secretAccessKey: 'local' });
  s3.s3Client.send = async () => ({ ContentLength: 2000000, ContentType: 'video/mp4' });

  const mockCourse = {
    _id: '6aab7f3954d18fda4f673a0d',
    courseId: 'CRS-TEST-1',
    status: 'published',
    modules: [{
      lessons: [{
        _id: 'les1',
        lessonTitle: 'Playback Test',
        s3Key: 'videos/playback.mp4',
        videoParts: [{
          title: 'Part 1',
          storageProvider: 's3',
          s3Key: 'videos/playback.mp4',
        }],
      }],
    }],
    toObject() { return JSON.parse(JSON.stringify(this)); },
  };

  Course.findOne = () => {
    const p = Promise.resolve(mockCourse);
    p.lean = async () => mockCourse;
    return p;
  };
  Course.findById = () => Promise.resolve(mockCourse);

  try {
    // 1. Test getMediaAccessUrl with COMPLETED HLS
    VideoConversion.findOne = () => {
      const doc = {
        originalS3Key: 'videos/playback.mp4',
        videoId: 'playback',
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback/playback.m3u8',
        hlsOutputPrefix: 'hls/playback/',
        mediaConvertJobId: 'job-1',
      };
      const p = Promise.resolve(doc);
      p.lean = async () => doc;
      return p;
    };

    const { req: r1, res: s1 } = mockReqRes({ query: { s3Key: 'videos/playback.mp4', courseId: 'CRS-TEST-1' } });
    await s3Controller.getMediaAccessUrl(r1, s1);
    assert.equal(s1.statusCode, 200);
    assert.equal(s1.responseBody.playbackType, 'hls');
    assert.equal(s1.responseBody.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback/playback.m3u8');
    assert.ok(s1.responseBody.url.includes('X-Amz-Signature='), 'Original MP4 signed url preserved');
    console.log('✔ getMediaAccessUrl returns correct HLS URL and preserves MP4 fallback');

    // 2. Test getMyCourseContent curriculum endpoint
    const { req: r2, res: s2 } = mockReqRes({ params: { courseId: 'CRS-TEST-1' } });
    await getMyCourseContent(r2, s2);
    assert.equal(s2.statusCode, 200);
    const curriculumLesson = s2.responseBody.data.course.modules[0].lessons[0];
    assert.equal(curriculumLesson.hlsConversionStatus, 'COMPLETED');
    assert.equal(curriculumLesson.hlsMasterUrl, 'https://d9rfsgqgwn1wa.cloudfront.net/hls/playback/playback.m3u8');
    assert.ok(curriculumLesson.videoUrl.includes('X-Amz-Signature='), 'Curriculum lesson has original MP4 fallback');
    console.log('✔ getMyCourseContent attaches HLS URL to student curriculum');
  } finally {
    Course.findOne = origFindOneCourse;
    VideoConversion.findOne = origFindOneVC;
    s3.s3Client.send = origSend;
  }
}

run().catch(console.error);
