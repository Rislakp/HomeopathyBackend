const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const config = require('../config/s3');
const courseController = require('../controllers/courseController');
const Course = require('../models/Course');

const defaultCredentialProvider = config.s3Client.config.credentials;
// Synthetic in-memory credentials for local test process
config.s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'local-test-only-secret' });
process.on('exit', () => { config.s3Client.config.credentials = defaultCredentialProvider; });

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const mockCourseFixture = () => {
  const courseId = 'CRS-' + Date.now();
  const moduleId = new mongoose.Types.ObjectId();
  const courseDoc = new Course({
    courseId,
    courseTitle: 'Live Class Verification Course',
    instructor: 'Instructor',
    price: 0,
    modules: [{
      _id: moduleId,
      moduleName: 'Module 1',
      lessons: [],
    }],
  });
  return { courseDoc, courseId, moduleId };
};

test('Live Class: video upload without meetingUrl keeps meetingUrl empty and preserves video', async (t) => {
  const { courseDoc, courseId, moduleId } = mockCourseFixture();
  const origFindOne = Course.findOne;
  Course.findOne = async () => courseDoc;
  courseDoc.save = async () => courseDoc;
  t.after(() => { Course.findOne = origFindOne; });

  const s3VideoUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1790881681290-7d17971b-Recording.mp4';
  const req = {
    params: { courseId, moduleId: moduleId.toString() },
    body: {
      lessonTitle: 'Live Session 1 Recording',
      lessonType: 'Live Class',
      uploadFileOrLink: s3VideoUrl,
      meetingUrl: '',
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();
  await courseController.addLesson(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);

  const lesson = res.body.data;
  assert.equal(lesson.meetingUrl, '', 'meetingUrl must remain empty when not explicitly provided');
  assert.ok(!lesson.meetingUrl.includes('1790881681290-7d17971b-Recording.mp4'), 'video URL must NOT be stored in meetingUrl');
  assert.ok(lesson.videoParts.length > 0, 'video must be stored in videoParts');
  assert.match(lesson.videoParts[0].url, /1790881681290-7d17971b-Recording\.mp4/, 'videoParts url must reference the uploaded video');

  // Verify internal stored subdocument
  const stored = courseDoc.modules[0].lessons[0];
  assert.equal(stored.meetingUrl, '', 'Stored lesson meetingUrl must remain empty');
  assert.ok(stored.videoParts.some((p) => (p.url && p.url.includes('1790881681290-7d17971b-Recording.mp4')) || p.s3Key === 'videos/1790881681290-7d17971b-Recording.mp4'), 'Stored lesson must have videoParts');
});

test('Live Class: explicit Google Meet URL is preserved when video is also provided', async (t) => {
  const { courseDoc, courseId, moduleId } = mockCourseFixture();
  const origFindOne = Course.findOne;
  Course.findOne = async () => courseDoc;
  courseDoc.save = async () => courseDoc;
  t.after(() => { Course.findOne = origFindOne; });

  const googleMeetUrl = 'https://meet.google.com/test-example';
  const s3VideoUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1790881681290-7d17971b-Recording.mp4';
  const req = {
    params: { courseId, moduleId: moduleId.toString() },
    body: {
      lessonTitle: 'Live Session 2 with Meet and Recording',
      lessonType: 'Live Class',
      meetingUrl: googleMeetUrl,
      uploadFileOrLink: s3VideoUrl,
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();
  await courseController.addLesson(req, res);

  assert.equal(res.statusCode, 201);
  const lesson = res.body.data;
  assert.equal(lesson.meetingUrl, googleMeetUrl, 'meetingUrl must contain exactly the explicit Google Meet URL');
  assert.ok(lesson.videoParts.some((p) => p.url && p.url.includes('1790881681290-7d17971b-Recording.mp4')), 'videoParts must contain the uploaded video URL');
  assert.notEqual(lesson.meetingUrl, s3VideoUrl, 'meetingUrl must not be replaced by video URL');
});

test('Live Class: updateLesson with video does not overwrite meetingUrl', async (t) => {
  const { courseDoc, courseId, moduleId } = mockCourseFixture();
  const lessonId = new mongoose.Types.ObjectId();
  const existingMeetUrl = 'https://meet.google.com/test-existing';
  courseDoc.modules[0].lessons.push({
    _id: lessonId,
    lessonTitle: 'Existing Live Class',
    lessonType: 'Live Class',
    meetingUrl: existingMeetUrl,
    videoParts: [],
    pdfNotes: [],
    assignments: [],
    attachments: [],
  });

  const origFindOne = Course.findOne;
  Course.findOne = async () => courseDoc;
  courseDoc.save = async () => courseDoc;
  t.after(() => { Course.findOne = origFindOne; });

  const newS3VideoUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/new-session.mp4';
  const req = {
    params: { courseId, moduleId: moduleId.toString(), lessonId: lessonId.toString() },
    body: {
      uploadFileOrLink: newS3VideoUrl,
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();
  await courseController.updateLesson(req, res);

  assert.equal(res.statusCode, 200);
  const lesson = res.body.data;
  assert.equal(lesson.meetingUrl, existingMeetUrl, 'meetingUrl must not be overwritten by uploaded video URL');
  assert.ok(lesson.videoParts.some((p) => p.url && p.url.includes('new-session.mp4')), 'videoParts must receive new video');
});

test('Live Class: updateLesson with explicit new Google Meet URL updates meetingUrl', async (t) => {
  const { courseDoc, courseId, moduleId } = mockCourseFixture();
  const lessonId = new mongoose.Types.ObjectId();
  courseDoc.modules[0].lessons.push({
    _id: lessonId,
    lessonTitle: 'Existing Live Class',
    lessonType: 'Live Class',
    meetingUrl: '',
    videoParts: [],
    pdfNotes: [],
    assignments: [],
    attachments: [],
  });

  const origFindOne = Course.findOne;
  Course.findOne = async () => courseDoc;
  courseDoc.save = async () => courseDoc;
  t.after(() => { Course.findOne = origFindOne; });

  const updatedMeetUrl = 'https://meet.google.com/new-meeting-code';
  const req = {
    params: { courseId, moduleId: moduleId.toString(), lessonId: lessonId.toString() },
    body: {
      meetingUrl: updatedMeetUrl,
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();
  await courseController.updateLesson(req, res);

  assert.equal(res.statusCode, 200);
  const lesson = res.body.data;
  assert.equal(lesson.meetingUrl, updatedMeetUrl, 'meetingUrl must be updated when explicitly provided');
});

test('Regression: Recorded Video lesson creation works normally', async (t) => {
  const { courseDoc, courseId, moduleId } = mockCourseFixture();
  const origFindOne = Course.findOne;
  Course.findOne = async () => courseDoc;
  courseDoc.save = async () => courseDoc;
  t.after(() => { Course.findOne = origFindOne; });

  const s3VideoUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/standard-lecture.mp4';
  const req = {
    params: { courseId, moduleId: moduleId.toString() },
    body: {
      lessonTitle: 'Standard Recorded Lecture',
      lessonType: 'Recorded Video',
      uploadFileOrLink: s3VideoUrl,
    },
    user: { id: 'admin-1', role: 'admin' },
  };
  const res = makeResponse();
  await courseController.addLesson(req, res);

  assert.equal(res.statusCode, 201);
  const lesson = res.body.data;
  assert.equal(lesson.meetingUrl, '', 'meetingUrl should be empty for Recorded Video');
  assert.ok(lesson.videoParts.some((p) => p.url && p.url.includes('standard-lecture.mp4')), 'videoParts should contain video');
});
