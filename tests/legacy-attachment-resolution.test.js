const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const {
  resolveMediaRecord,
  getVerifiedS3KeyForLegacyAsset,
  VERIFIED_LEGACY_ASSETS,
  normalizeS3Reference,
  encodeSignedUrl,
} = require('../utils/s3MediaSigner');
const s3UploadController = require('../controllers/s3UploadController');
const Course = require('../models/Course');
const User = require('../models/User');

// Helper to mock express req/res
function mockReqRes(query = {}, body = {}, user = null) {
  const req = {
    query,
    body,
    user: user || { id: 'admin1', role: 'admin', email: 'admin@test.com' },
  };
  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return { req, res };
}

test('1. getVerifiedS3KeyForLegacyAsset resolves verified historical filenames and URLs', () => {
  // Direct lowercase
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('pharmacy oct 6.pdf'),
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf'
  );
  // Full URL with domain
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('https://homeopathybackend-1.onrender.com/uploads/Pharmacy OCT 6.pdf'),
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf'
  );
  // URL-encoded space
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('https://api.whitecoat.academy/uploads/Pharmacy%20OCT%206.docx.pdf'),
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf'
  );
  // ASST PHARMACY with duplicate counter (1)
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('https://api.whitecoat.academy/uploads/ASST PHARMACY (1).pdf'),
    'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf'
  );
  // Without counter
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('ASST PHARMACY.pdf'),
    'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf'
  );
});

test('2. getVerifiedS3KeyForLegacyAsset returns null for genuinely missing attachments', () => {
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf'),
    null
  );
  assert.equal(
    getVerifiedS3KeyForLegacyAsset('https://api.whitecoat.academy/uploads/non-existent-random.pdf'),
    null
  );
});

test('3. resolveMediaRecord generates fresh signed URLs for verified legacy uploads', async () => {
  const legacyRecord = {
    title: 'Pharmacy OCT 6.pdf',
    url: 'https://homeopathybackend-1.onrender.com/uploads/Pharmacy OCT 6.pdf',
  };

  const resolved = await resolveMediaRecord(legacyRecord);
  assert.equal(resolved.storageProvider, 's3');
  assert.equal(resolved.s3Key, 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf');
  assert.ok(resolved.url.startsWith('https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/'));
  assert.ok(resolved.url.includes('X-Amz-Signature'));
  assert.ok(!resolved.url.includes('+'), 'Plus signs are encoded in URL');
});

test('4. resolveMediaRecord safely marks genuinely missing legacy documents as unavailable', async () => {
  const missingRecord = {
    title: 'SAMPLE QUESTION - RESPIRATORY.pdf',
    url: 'https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf',
  };

  const resolved = await resolveMediaRecord(missingRecord);
  assert.equal(resolved.available, false);
  assert.equal(
    resolved.resolutionError,
    'This legacy document is no longer available on the server and has no verified S3 backup.'
  );
});

test('5. resolveMediaRecord handles expired S3 presigned URLs seamlessly', async () => {
  const expiredRecord = {
    title: 'Expired S3 Asset',
    url: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf?X-Amz-Signature=old123&X-Amz-Expires=900',
  };

  const resolved = await resolveMediaRecord(expiredRecord);
  assert.equal(resolved.storageProvider, 's3');
  assert.equal(resolved.s3Key, 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf');
  assert.ok(resolved.url.startsWith('https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/'));
  assert.ok(resolved.url.includes('X-Amz-Signature'));
});

test('6. resolveMediaRecord leaves external non-S3 URLs (e.g. Cloudinary) intact', async () => {
  const cloudinaryRecord = {
    title: 'Cloudinary Asset',
    url: 'https://res.cloudinary.com/vadgpisw/image/upload/v1/sample.pdf',
  };

  const resolved = await resolveMediaRecord(cloudinaryRecord);
  assert.equal(resolved.url, 'https://res.cloudinary.com/vadgpisw/image/upload/v1/sample.pdf');
  assert.equal(resolved.storageProvider, undefined);
});

test('7. s3UploadController.getMediaAccessUrl resolves legacy ASST PHARMACY (1).pdf to fresh signed URL', async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { req, res } = mockReqRes({
    s3Key: 'https://api.whitecoat.academy/uploads/ASST PHARMACY (1).pdf',
  });

  await s3UploadController.getMediaAccessUrl(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonData.success, true);
  assert.equal(
    res.jsonData.s3Key,
    'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf'
  );
  assert.ok(res.jsonData.url.startsWith('https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/'));
  assert.ok(!res.jsonData.url.includes('/uploads/'));
  assert.ok(!res.jsonData.url.includes('+'));

  await mongoose.disconnect();
});

test('8. s3UploadController.getMediaAccessUrl resolves legacy Pharmacy OCT 6.pdf to fresh signed URL', async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { req, res } = mockReqRes({
    s3Key: 'https://homeopathybackend-1.onrender.com/uploads/Pharmacy OCT 6.pdf',
  });

  await s3UploadController.getMediaAccessUrl(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonData.success, true);
  assert.equal(
    res.jsonData.s3Key,
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf'
  );
  assert.ok(res.jsonData.url.startsWith('https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/'));
  assert.ok(!res.jsonData.url.includes('/uploads/'));

  await mongoose.disconnect();
});

test('9. s3UploadController.getMediaAccessUrl returns 404 for genuinely missing legacy attachment', async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { req, res } = mockReqRes({
    s3Key: 'https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf',
  });

  await s3UploadController.getMediaAccessUrl(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.jsonData.success, false);
  assert.equal(
    res.jsonData.message,
    'This legacy document is no longer available on the server and has no verified S3 backup.'
  );

  await mongoose.disconnect();
});

test('10. s3UploadController.getMediaAccessUrl resolves newly uploaded S3 key cleanly', async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { req, res } = mockReqRes({
    s3Key: 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
  });

  await s3UploadController.getMediaAccessUrl(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonData.success, true);
  assert.equal(
    res.jsonData.s3Key,
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf'
  );
  assert.ok(res.jsonData.url.startsWith('https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/'));

  await mongoose.disconnect();
});

test('11. s3UploadController.getMediaAccessUrl returns Cloudinary URL directly without error', async () => {
  const { req, res } = mockReqRes({
    s3Key: 'https://res.cloudinary.com/vadgpisw/image/upload/v1/sample.pdf',
  });

  await s3UploadController.getMediaAccessUrl(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonData.success, true);
  assert.equal(
    res.jsonData.url,
    'https://res.cloudinary.com/vadgpisw/image/upload/v1/sample.pdf'
  );
});
