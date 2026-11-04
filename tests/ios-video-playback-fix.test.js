require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { signS3Reference, resolveMediaRecord } = require('../utils/s3MediaSigner');
const { initiateMultipartUpload } = require('../controllers/s3UploadController');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');
const Course = require('../models/Course');
const Student = require('../models/Student');

test('1. S3 Multipart Upload rejects WEBM uploads with explicit error message', async () => {
  let status1 = 0;
  let body1 = null;
  const res1 = {
    status(s) { status1 = s; return this; },
    json(b) { body1 = b; return this; }
  };
  await initiateMultipartUpload({
    body: { fileName: 'test-recording.webm', contentType: 'video/webm' }
  }, res1);
  assert.equal(status1, 400);
  assert.equal(body1.success, false);
  assert.equal(body1.message, 'WEBM format is not supported for iOS/Safari playback. Please upload MP4 with H.264 video and AAC audio.');

  let status2 = 0;
  let body2 = null;
  const res2 = {
    status(s) { status2 = s; return this; },
    json(b) { body2 = b; return this; }
  };
  await initiateMultipartUpload({
    body: { fileName: 'test-recording.webm', contentType: 'video/mp4' }
  }, res2);
  assert.equal(status2, 400);
  assert.equal(body2.success, false);
  assert.equal(body2.message, 'WEBM format is not supported for iOS/Safari playback. Please upload MP4 with H.264 video and AAC audio.');
});

test('2. S3 Media Signer enforces video/mp4 for MP4 keys even when title has .webm', async () => {
  const resource = {
    title: 'RESPIRATORY 1.webm',
    s3Key: 'videos/1793013512772-1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1_faststart.mp4',
    mimetype: 'video/webm',
    contentType: 'video/webm',
    storageProvider: 's3'
  };

  const resolved = await resolveMediaRecord(resource);
  assert.ok(resolved.url, 'Signed URL should be present');
  assert.ok(resolved.url.includes('response-content-type=video%2Fmp4'), 'Presigned URL must have video/mp4');
  assert.ok(!resolved.url.includes('response-content-type=video%2Fwebm'), 'Presigned URL must NOT have video/webm');

  const signed = await signS3Reference(resource, 'video/webm');
  assert.ok(signed.url.includes('response-content-type=video%2Fmp4'), 'Presigned URL must enforce video/mp4 for .mp4 key');
});

test('3. studentCurriculumController delivers compatible MP4 URL to lesson.videoUrl', async (t) => {
  const origFindOne = Course.findOne;
  const origFindById = Course.findById;
  t.after(() => {
    Course.findOne = origFindOne;
    Course.findById = origFindById;
  });

  const mockCourse = {
    _id: '6aab7f3954d18fda4f673a0d',
    courseId: 'CRS-000070',
    courseTitle: 'COMBO COURSE',
    status: 'Published',
    modules: [
      {
        _id: 'mod1',
        moduleName: 'Pharmacy',
        lessons: [
          {
            _id: 'les3',
            lessonTitle: 'PART 3',
            lessonType: 'Live Class',
            s3Key: 'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4',
            videoParts: [
              {
                title: 'PHARMACY PART 3',
                storageProvider: 's3',
                s3Key: 'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4',
                contentType: 'video/mp4',
                mimetype: 'video/mp4'
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
    params: { courseId: 'CRS-000070' },
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
  const lesson = course.modules[0].lessons[0];

  assert.ok(lesson.videoUrl, 'lesson.videoUrl must be generated');
  assert.ok(lesson.videoUrl.includes('response-content-type=video%2Fmp4'), 'lesson.videoUrl must have video/mp4 ContentType');
  assert.ok(!lesson.videoUrl.includes('response-content-type=video%2Fwebm'), 'lesson.videoUrl must NOT have video/webm');
});

