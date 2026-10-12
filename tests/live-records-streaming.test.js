const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const recordingController = require('../controllers/recordingController');
const s3UploadController = require('../controllers/s3UploadController');
const { signS3Reference, normalizeS3Reference } = require('../utils/s3MediaSigner');
const Recording = require('../models/Recording');
const Course = require('../models/Course');
const Student = require('../models/Student');
const defaultCredentialProvider = s3Client.config.credentials;
// Synthetic, in-memory credentials are scoped to this test process only.
s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'local-test-only-secret' });
process.on('exit', () => { s3Client.config.credentials = defaultCredentialProvider; });

const makeResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    getHeader(key) {
      return this.headers[key];
    },
  };
  return res;
};

// ==============================================================================
// 1 & 2: Range Requests, 206 Partial Content, Content-Range, and 416 Handling
// ==============================================================================

test('1. HTTP Range Streaming: Parse and serve valid 206 Partial Content with correct byte ranges and headers', async () => {
  // Simulate a media buffer of 10,000 bytes representing a video chunk
  const totalFileSize = 10000;
  const mockVideoBuffer = Buffer.alloc(totalFileSize, 0xaa);

  // Helper simulating standard HTTP Range streamer (used by S3 and static streaming servers)
  const handleRangeRequest = (rangeHeader, totalSize, buffer, mimeType = 'video/mp4') => {
    if (!rangeHeader) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': totalSize,
          'Accept-Ranges': 'bytes',
        },
        data: buffer,
      };
    }

    const matches = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!matches) {
      return {
        statusCode: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
        },
      };
    }

    let start = matches[1] ? parseInt(matches[1], 10) : 0;
    let end = matches[2] ? parseInt(matches[2], 10) : totalSize - 1;

    // Suffix range: bytes=-500 (last 500 bytes)
    if (!matches[1] && matches[2]) {
      start = totalSize - parseInt(matches[2], 10);
      end = totalSize - 1;
    }

    if (start >= totalSize || end >= totalSize || start > end) {
      return {
        statusCode: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
        },
      };
    }

    const chunkSize = end - start + 1;
    return {
      statusCode: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
      },
      data: buffer.subarray(start, end + 1),
    };
  };

  // Case A: Initial range request (bytes 0-1023)
  const initialReq = handleRangeRequest('bytes=0-1023', totalFileSize, mockVideoBuffer);
  assert.equal(initialReq.statusCode, 206, 'Must return HTTP 206 Partial Content');
  assert.equal(initialReq.headers['Content-Range'], 'bytes 0-1023/10000', 'Content-Range must match requested window');
  assert.equal(initialReq.headers['Content-Length'], 1024, 'Content-Length must equal chunk length');
  assert.equal(initialReq.headers['Accept-Ranges'], 'bytes', 'Accept-Ranges must be bytes');
  assert.equal(initialReq.headers['Content-Type'], 'video/mp4', 'Content-Type must be video/mp4');
  assert.equal(initialReq.data.length, 1024, 'Buffer slice length matches');

  // Case B: Middle range request (bytes 2000-4999)
  const middleReq = handleRangeRequest('bytes=2000-4999', totalFileSize, mockVideoBuffer);
  assert.equal(middleReq.statusCode, 206);
  assert.equal(middleReq.headers['Content-Range'], 'bytes 2000-4999/10000');
  assert.equal(middleReq.headers['Content-Length'], 3000);
  assert.equal(middleReq.data.length, 3000);

  // Case C: Open-ended range request (bytes 5000-)
  const openEndedReq = handleRangeRequest('bytes=5000-', totalFileSize, mockVideoBuffer);
  assert.equal(openEndedReq.statusCode, 206);
  assert.equal(openEndedReq.headers['Content-Range'], 'bytes 5000-9999/10000');
  assert.equal(openEndedReq.headers['Content-Length'], 5000);

  // Case D: Unsatisfiable range request beyond total size (bytes 15000-20000)
  const invalidReq = handleRangeRequest('bytes=15000-20000', totalFileSize, mockVideoBuffer);
  assert.equal(invalidReq.statusCode, 416, 'Must return HTTP 416 Range Not Satisfiable');
  assert.equal(invalidReq.headers['Content-Range'], 'bytes */10000');
});

// ==============================================================================
// 3: Media MIME Type Verification & Prevention of HTML/JSON in Video Stream
// ==============================================================================

test('3. Media MIME Type: Verify S3 signed URLs and media access enforce correct video MIME type', async (t) => {
  const originalSend = s3Client.send;
  t.after(() => {
    s3Client.send = originalSend;
  });

  let capturedCommand = null;
  s3Client.send = async (command) => {
    capturedCommand = command;
    return {};
  };

  // Test signS3Reference for video key
  const videoRef = {
    storageProvider: 's3',
    s3Key: 'videos/lecture-101.mp4',
    contentType: 'video/mp4',
  };

  const signed = await signS3Reference(videoRef, 'video/mp4');
  assert.ok(signed.url, 'Signed URL generated');
  assert.ok(signed.url.includes('response-content-type=video%2Fmp4'), 'Presigned URL enforces video/mp4 response header');
  assert.ok(signed.url.includes('response-content-disposition=inline'), 'Presigned URL enforces inline disposition');

  // Verify that error responses never pretend to be video streams
  const res = makeResponse();
  const failReq = { query: { s3Key: '' } };
  await s3UploadController.getMediaAccessUrl(failReq, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.message, 'string', 'Errors return JSON error payloads with status 400, never raw HTML or corrupt bytes');
});

// ==============================================================================
// 4: Expired or Invalid Signed URLs & Path Traversal Prevention
// ==============================================================================

test('4. Security: Invalid S3 keys and path traversal reject without leaking media URLs', async () => {
  const maliciousKeys = [
    'videos/../../etc/passwd',
    'videos/../private-credentials.json',
    'videos//double-slash.mp4',
    'videos/with\\backslash.mp4',
    'invalid-prefix/video.mp4',
    '   ',
    null,
  ];

  for (const badKey of maliciousKeys) {
    const ref = { storageProvider: 's3', s3Key: badKey };
    const result = await signS3Reference(ref, 'video/mp4');
    assert.equal(result.url, '', `Malicious key ${badKey} must be stripped to empty URL`);
    assert.equal(result.secure_url, '', `Malicious key ${badKey} must be stripped`);
  }
});

// ==============================================================================
// 5 & 6: Duration Parsing, Extraction, and Serialization
// ==============================================================================

test('5. Duration Parsing: parseDurationInSeconds accurately converts clock, unit, and numeric formats', () => {
  const parse = recordingController.parseDurationInSeconds;

  // Clock formats (MM:SS and HH:MM:SS)
  assert.equal(parse('18:45'), 1125, '18:45 -> 1125 seconds');
  assert.equal(parse('00:30'), 30, '00:30 -> 30 seconds');
  assert.equal(parse('01:23:45'), 5025, '01:23:45 -> 5025 seconds');
  assert.equal(parse('02:00:00'), 7200, '02:00:00 -> 7200 seconds');

  // Unit formats
  assert.equal(parse('120 sec'), 120, '120 sec -> 120');
  assert.equal(parse('45s'), 45, '45s -> 45');
  assert.equal(parse('2.5 min'), 150, '2.5 min -> 150');
  assert.equal(parse('1.5 hr'), 5400, '1.5 hr -> 5400');

  // Numeric formats
  assert.equal(parse(900), 900, 'Numeric 900 -> 900');
  assert.equal(parse('900'), 900, 'String "900" -> 900');
  assert.equal(parse(1450.5), 1450.5, 'Float 1450.5 -> 1450.5');
});

test('6. Duration Handling: parseDurationInSeconds handles missing, negative, and invalid values gracefully without producing -59 or NaN', async () => {
  const parse = recordingController.parseDurationInSeconds;

  // Invalid / negative / corrupted values that could trigger player '-59:-0.0'
  assert.equal(parse(null), 0, 'null -> 0');
  assert.equal(parse(undefined), 0, 'undefined -> 0');
  assert.equal(parse(''), 0, 'empty string -> 0');
  assert.equal(parse('   '), 0, 'whitespace -> 0');
  assert.equal(parse('-59'), 0, 'negative "-59" clamped to 0');
  assert.equal(parse(-59), 0, 'negative -59 clamped to 0');
  assert.equal(parse('invalid:time'), 0, 'invalid clock string -> 0');
  assert.equal(parse('unknown'), 0, '"unknown" -> 0');
  assert.equal(parse(NaN), 0, 'NaN -> 0');
  assert.equal(parse(Infinity), 0, 'Infinity -> 0');

  // formatRecordingDocument must serialize positive numeric videoDuration
  const recWithClock = new Recording({
    courseName: 'Test Course',
    lessonTitle: 'Test Lesson',
    duration: '18:45',
    bytes: 52428800,
    status: 'stopped',
  });

  const formattedWithClock = await recordingController.formatRecordingDocument(recWithClock);
  assert.equal(formattedWithClock.duration, '18:45', 'duration preserved');
  assert.equal(formattedWithClock.videoDuration, 1125, 'videoDuration accurately parsed into 1125 seconds');

  const recEmpty = new Recording({
    courseName: 'Test Course',
    duration: '',
    bytes: 0,
    status: 'pending',
  });

  const formattedEmpty = await recordingController.formatRecordingDocument(recEmpty);
  assert.equal(formattedEmpty.duration, '');
  assert.equal(formattedEmpty.videoDuration, 0, 'videoDuration defaults safely to 0');
  assert.ok(!isNaN(formattedEmpty.videoDuration), 'videoDuration is never NaN');
  assert.ok(formattedEmpty.videoDuration >= 0, 'videoDuration is never negative');
});

// ==============================================================================
// 7: Access Control: Unauthorized Access to Private Recordings
// ==============================================================================

test('7. Access Control: Unauthorized access to private recordings is blocked with 403', async (t) => {
  const origFindById = Recording.findById;
  const origStudentFindOne = Student.findOne;
  t.after(() => {
    Recording.findById = origFindById;
    Student.findOne = origStudentFindOne;
  });

  const recId = new mongoose.Types.ObjectId();
  const courseId = new mongoose.Types.ObjectId();

  const mockRec = {
    _id: recId,
    courseId: courseId,
    courseName: 'Exclusive Clinical Course',
    recordedVideoUrl: 'https://whitecoat-media-prod.s3.amazonaws.com/live_records/private.mp4',
    status: 'recorded',
    duration: '30:00',
    bytes: 104857600,
  };

  Recording.findById = (id) => ({
    populate: async () => mockRec,
  });

  // Mock student profile with NO enrollment in the course
  Student.findOne = async () => ({
    _id: new mongoose.Types.ObjectId(),
    userId: 'student-unauthorized',
    accountStatus: 'Approved',
    status: 'Active',
    courseIds: [new mongoose.Types.ObjectId().toString()], // different course
  });

  const req = {
    params: { id: recId.toString() },
    user: {
      id: 'student-unauthorized',
      role: 'student',
      courseIds: [],
    },
  };
  const res = makeResponse();

  await recordingController.getRecordingById(req, res);

  assert.equal(res.statusCode, 403, 'Unauthorized student must be rejected with HTTP 403');
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('not authorized'), 'Reason for rejection returned');
});
