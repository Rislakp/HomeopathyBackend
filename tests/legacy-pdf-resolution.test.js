const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mock getSignedUrl
const presigner = require('@aws-sdk/s3-request-presigner');
const originalGetSignedUrl = presigner.getSignedUrl;
presigner.getSignedUrl = async (client, command, options) => {
  const key = command.input.Key;
  return `https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=test+sig%2Btoken&X-Amz-Expires=900&response-content-type=application/pdf`;
};

const config = require('../config/s3');
config.s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'local-test-only-secret' });
config.s3Client.send = async (command) => {
  if (command.constructor.name === 'HeadObjectCommand') {
    return { ContentLength: 512, ContentType: 'application/pdf' };
  }
  return {};
};

const { resolveMediaRecord, normalizeS3Reference, signS3Reference } = require('../utils/s3MediaSigner');
const controller = require('../controllers/s3UploadController');
const Course = require('../models/Course');
const Student = require('../models/Student');

test('1. New PDF with valid S3 key and storageProvider resolves fresh signed URL', async () => {
  const newPdf = {
    storageProvider: 's3',
    s3Key: 'pdfs/1791954076419-f4d08597-aff7-4a8d-853d-dc12fdf4b591-RESPIRATORY-SYSTEM-LESSON-1.pdf',
    title: 'RESPIRATORY SYSTEM LESSON 1.pdf',
    contentType: 'application/pdf',
  };

  const resolved = await resolveMediaRecord(newPdf, { responseContentType: 'application/pdf' });
  assert.ok(resolved.url, 'Should have signed URL');
  assert.ok(resolved.url.includes('RESPIRATORY-SYSTEM-LESSON-1.pdf'), 'Should point to correct object');
  assert.ok(resolved.url.includes('%2B'), 'Should encode literal plus sign');
  assert.strictEqual(resolved.url.includes('+'), false, 'Should have no raw plus in query');
  assert.ok(resolved.accessUrlExpiresIn >= 900);
});

test('2. Old PDF with missing storageProvider but valid S3 key normalizes and signs', async () => {
  const oldPdfMissingProvider = {
    s3Key: 'pdfs/1791091521866-c6991950-12c3-4dfd-ba72-79eaa69d08d7-pharmacy-note-pt-1.docx-1-.pdf',
    title: 'pharmacy note pt 1.docx (1).pdf',
    url: '',
  };

  const resolved = await resolveMediaRecord(oldPdfMissingProvider, { responseContentType: 'application/pdf' });
  assert.strictEqual(resolved.storageProvider, 's3');
  assert.ok(resolved.url, 'Should have signed URL');
  assert.ok(resolved.url.includes('pharmacy-note-pt-1.docx-1-.pdf'));
});

test('3. Legacy /uploads/... URL with verified matching S3 object in course curriculum resolves to S3 signed URL', async () => {
  const verifiedCourse = {
    courseId: 'CRS-VERIFIED',
    modules: [{
      lessons: [{
        pdfNotes: [{
          _id: new mongoose.Types.ObjectId('6ac638f273250cecf366de3e'),
          title: 'Pharmacy OCT 6.pdf',
          fileName: 'Pharmacy OCT 6.pdf',
          fileSize: 2048,
          storageProvider: 's3',
          s3Key: 'pdfs/1791091529068-verified-pharmacy.pdf',
        }]
      }]
    }]
  };

  const legacyItem = {
    _id: new mongoose.Types.ObjectId('6ac638f273250cecf366de3e'),
    title: 'Pharmacy OCT 6.pdf',
    url: 'https://homeopathybackend-1.onrender.com/uploads/Pharmacy OCT 6.pdf',
    fileSize: 2048,
  };

  const resolved = await resolveMediaRecord(legacyItem, { course: verifiedCourse });
  assert.ok(resolved.url, 'Should resolve to signed URL');
  assert.ok(resolved.url.includes('pdfs/1791091529068-verified-pharmacy.pdf'));
  assert.strictEqual(resolved.storageProvider, 's3');
});

test('4. Legacy /uploads/... reference with NO verified matching S3 object returns safe unverified status without credentials', async () => {
  const unverifiedCourse = {
    courseId: 'CRS-EMPTY',
    modules: [{ lessons: [] }]
  };

  const unverifiedItem = {
    title: 'Nonexistent Document.pdf',
    url: 'https://homeopathybackend-1.onrender.com/uploads/Nonexistent Document.pdf',
  };

  const resolved = await resolveMediaRecord(unverifiedItem, { course: unverifiedCourse });
  assert.strictEqual(resolved.available, false);
  assert.ok(resolved.resolutionError.includes('no verified S3 backup'));
  assert.strictEqual(resolved.url, 'https://homeopathybackend-1.onrender.com/uploads/Nonexistent Document.pdf');
  assert.strictEqual(resolved.accessUrlExpiresIn, undefined);
});

test('5. getMediaAccessUrl rejects unauthorized student with 403', async (t) => {
  const origFindOne = Course.findOne;
  const origStudentFindOne = Student.findOne;

  const key = 'pdfs/unauth-test.pdf';
  Course.findOne = async () => ({
    _id: new mongoose.Types.ObjectId(),
    courseId: 'CRS-UNAUTH',
    modules: [{ lessons: [{ pdfNotes: [{ s3Key: key }] }] }],
  });
  Student.findOne = () => {
    const p = Promise.resolve(null);
    p.lean = async () => null;
    return p;
  };

  t.after(() => {
    Course.findOne = origFindOne;
    Student.findOne = origStudentFindOne;
  });

  const req = {
    query: { s3Key: key, courseId: 'CRS-UNAUTH' },
    user: { id: 'unauth-student', role: 'student' },
  };
  let statusCode = 200;
  let resBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { resBody = data; return this; },
  };

  await controller.getMediaAccessUrl(req, res);
  assert.strictEqual(statusCode, 403);
  assert.strictEqual(resBody.success, false);
  assert.ok(resBody.message.includes('Student profile') || resBody.message.includes('access'));
});

test('6. getMediaAccessUrl returns 404 for unverified legacy /uploads/ URL', async (t) => {
  const origFindOne = Course.findOne;

  Course.findOne = async () => ({
    _id: new mongoose.Types.ObjectId(),
    courseId: 'CRS-AIAPGET',
    modules: [{
      lessons: [{
        attachments: [{
          title: 'SAMPLE QUESTION - RESPIRATORY.pdf',
          url: 'https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf',
        }]
      }]
    }]
  });

  t.after(() => {
    Course.findOne = origFindOne;
  });

  const req = {
    query: { s3Key: 'https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf' },
    user: { id: 'admin-tester', role: 'admin' },
  };
  let statusCode = 200;
  let resBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { resBody = data; return this; },
  };

  await controller.getMediaAccessUrl(req, res);
  assert.strictEqual(statusCode, 404);
  assert.strictEqual(resBody.success, false);
  assert.ok(resBody.message.includes('no verified S3 backup'));
});

process.on('exit', () => {
  presigner.getSignedUrl = originalGetSignedUrl;
});
