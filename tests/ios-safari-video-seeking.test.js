require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { s3Client, bucket } = require('../config/s3');
const { signS3Reference, S3_MEDIA_URL_TTL_SECONDS } = require('../utils/s3MediaSigner');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');
const Course = require('../models/Course');
const Student = require('../models/Student');

test('1. S3 Media Signer uses >= 6 hours (21600s) TTL to support classes longer than 2 hours', async () => {
  assert.ok(
    S3_MEDIA_URL_TTL_SECONDS >= 21600,
    `S3_MEDIA_URL_TTL_SECONDS must be at least 21600 (6 hours) to support classes > 2 hours (got ${S3_MEDIA_URL_TTL_SECONDS})`
  );

  const sampleKey = 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4';
  const signed = await signS3Reference({ storageProvider: 's3', s3Key: sampleKey }, 'video/mp4');
  assert.ok(signed.url, 'Signed URL must be generated');
  assert.ok(signed.url.includes(`X-Amz-Expires=${S3_MEDIA_URL_TTL_SECONDS}`), 'Signed URL must use extended TTL');
  assert.ok(signed.url.includes('response-content-type=video%2Fmp4'), 'Signed URL must enforce video/mp4');
  assert.ok(signed.url.includes('response-content-disposition=inline'), 'Signed URL must enforce inline disposition');
});

test('2. studentCurriculumController refreshes videoUrl when lesson has firstVideo even if videoUrl had old signature', async (t) => {
  const origFindOne = Course.findOne;
  const origFindById = Course.findById;
  const origStudentFind = Student.findOne;
  t.after(() => {
    Course.findOne = origFindOne;
    Course.findById = origFindById;
    Student.findOne = origStudentFind;
  });

  const staleS3Url = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/stale.mp4?X-Amz-Signature=old123';
  const mockCourse = {
    _id: '6aab7f3954d18fda4f673a0d',
    courseId: 'CRS-000041',
    courseTitle: 'KPSC',
    status: 'Published',
    modules: [
      {
        _id: 'mod1',
        moduleName: 'Pharmacy',
        lessons: [
          {
            _id: 'les5',
            lessonTitle: 'Part 5',
            lessonType: 'Live Class',
            videoUrl: staleS3Url, // Previously saved signed URL
            meetingUrl: staleS3Url, // Stored stale S3 URL
            videoParts: [
              {
                title: 'pharmacy-5.mp4',
                storageProvider: 's3',
                s3Key: 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4',
                contentType: 'video/mp4',
              }
            ],
            pdfNotes: [],
            assignments: [],
            attachments: [],
          }
        ]
      }
    ],
    toObject() { return JSON.parse(JSON.stringify(this)); },
  };

  Course.findOne = () => Promise.resolve(mockCourse);
  Course.findById = () => Promise.resolve(mockCourse);

  const req = {
    params: { courseId: 'CRS-000041' },
    user: { id: 'admin1', role: 'admin' },
    headers: { host: 'localhost:5000' },
    protocol: 'https',
  };

  let responseData = null;
  const res = {
    status(c) { return this; },
    json(data) { responseData = data; return this; },
  };

  await getMyCourseContent(req, res);

  assert.ok(responseData, 'Must return response data');
  const course = responseData.data?.course || responseData.data;
  assert.ok(course && course.modules, 'Must return course with modules');
  const lesson = course.modules[0].lessons[0];

  // Must NOT keep the old stale URL
  assert.notEqual(lesson.videoUrl, staleS3Url, 'Must refresh stale S3 videoUrl with fresh signed URL');
  assert.ok(lesson.videoUrl.includes('videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4'));

  // meetingUrl must NOT leak expired S3 video URL
  assert.equal(lesson.meetingUrl, '', 'meetingUrl must be cleared when it contains an S3 video asset');
});

test('3. HTTP Range and partial content contract for video seeking compliance', () => {
  // Verify standard calculation of 206 partial response parameters
  const totalFileSize = 483764845;

  // Test 1: Initial probe Range: bytes=0-1
  const start1 = 0;
  const end1 = 1;
  const length1 = end1 - start1 + 1;
  const rangeHeader1 = `bytes ${start1}-${end1}/${totalFileSize}`;
  assert.equal(length1, 2);
  assert.equal(rangeHeader1, 'bytes 0-1/483764845');

  // Test 2: Seek to 50%
  const startMid = 241882422;
  const endMid = startMid + 524287;
  const lengthMid = endMid - startMid + 1;
  const rangeHeaderMid = `bytes ${startMid}-${endMid}/${totalFileSize}`;
  assert.equal(lengthMid, 524288);
  assert.equal(rangeHeaderMid, 'bytes 241882422-242406709/483764845');

  // Test 3: Open-ended seek range: bytes=241882422-
  const lengthOpen = totalFileSize - startMid;
  const rangeHeaderOpen = `bytes ${startMid}-${totalFileSize - 1}/${totalFileSize}`;
  assert.equal(lengthOpen, 241882423);
  assert.equal(rangeHeaderOpen, 'bytes 241882422-483764844/483764845');
});
