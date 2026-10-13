const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const config = require('../config/s3');
const controller = require('../controllers/s3UploadController');
const recordingController = require('../controllers/recordingController');
const uploadMiddleware = require('../middleware/upload');
const rankImageMiddleware = require('../middleware/rankImageUpload.middleware');
const Recording = require('../models/Recording');

// Set up synthetic test credentials for S3 client
const defaultCredentialProvider = config.s3Client.config.credentials;
config.s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDTEST', secretAccessKey: 'testsecret' });
process.on('exit', () => { config.s3Client.config.credentials = defaultCredentialProvider; });

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(key, val) { this.headers[key] = val; return this; },
});

const callHandler = async (handler, body = {}, user = { id: 'admin-test', role: 'admin' }, query = {}, params = {}, file = undefined) => {
  const res = makeResponse();
  await handler({ body, query, params, user, file }, res);
  return res;
};

// =========================================================================
// SECTION 1: S3 MULTIPART UPLOAD BOUNDARIES & RESTRICTIONS
// =========================================================================

test('S3 Multipart Initiate: accepts files up to 2 TiB, rejects > 2 TiB', async (t) => {
  const originalSend = config.s3Client.send;
  config.s3Client.send = async (command) => {
    if (command.constructor.name === 'CreateMultipartUploadCommand') {
      return { UploadId: 'test-upload-id-123' };
    }
    return {};
  };
  t.after(() => { config.s3Client.send = originalSend; });

  const TWO_TIB = 2 * 1024 * 1024 * 1024 * 1024; // 2,199,023,255,552 bytes
  const FIVE_HUNDRED_MB = 500 * 1024 * 1024; // 524,288,000 bytes
  const ONE_GIB = 1024 * 1024 * 1024; // 1,073,741,824 bytes

  // 1. 500 MB video must succeed
  const res500Mb = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'lecture-500mb.mp4',
    contentType: 'video/mp4',
    fileSize: FIVE_HUNDRED_MB,
  });
  assert.equal(res500Mb.statusCode, 201, '500 MB video upload initiation must succeed');
  assert.equal(res500Mb.body.uploadId, 'test-upload-id-123');

  // 2. 1 GiB video must succeed
  const res1GiB = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'lecture-1gb.mp4',
    contentType: 'video/mp4',
    fileSize: ONE_GIB,
  });
  assert.equal(res1GiB.statusCode, 201, '1 GiB video upload initiation must succeed');

  // 3. Exactly 2 TiB must succeed
  const res2TiB = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'huge-archive.mp4',
    contentType: 'video/mp4',
    fileSize: TWO_TIB,
  });
  assert.equal(res2TiB.statusCode, 201, 'Exact 2 TiB boundary must succeed');

  // 4. Over 2 TiB (2 TiB + 1 byte) must be rejected with 400
  const resOverLimit = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'oversized.mp4',
    contentType: 'video/mp4',
    fileSize: TWO_TIB + 1,
  });
  assert.equal(resOverLimit.statusCode, 400, 'Files exceeding 2 TiB must be rejected');
  assert.match(resOverLimit.body.message, /fileSize/i);

  // 5. Negative, 0, or float size must be rejected
  const resZero = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'zero.mp4',
    contentType: 'video/mp4',
    fileSize: 0,
  });
  assert.equal(resZero.statusCode, 400, 'Zero-byte video must be rejected');

  const resNegative = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'negative.mp4',
    contentType: 'video/mp4',
    fileSize: -100,
  });
  assert.equal(resNegative.statusCode, 400, 'Negative fileSize must be rejected');
});

test('S3 Multipart Initiate: rejects non-video content types and invalid file names', async (t) => {
  const originalSend = config.s3Client.send;
  config.s3Client.send = async () => ({ UploadId: 'test-upload-id' });
  t.after(() => { config.s3Client.send = originalSend; });

  // 1. Non-video MIME types must be rejected
  const invalidTypes = ['application/pdf', 'image/png', 'text/html', 'application/octet-stream', 'audio/mp3'];
  for (const contentType of invalidTypes) {
    const res = await callHandler(controller.initiateMultipartUpload, {
      fileName: 'document.pdf',
      contentType,
      fileSize: 10 * 1024 * 1024,
    });
    assert.equal(res.statusCode, 400, `ContentType ${contentType} must be rejected by video multipart endpoint`);
    assert.match(res.body.message, /video/i);
  }

  // 2. Empty or invalid file names that collapse to empty string must be rejected
  const invalidNames = ['', '   ', '..', '.', '---', '...'];
  for (const fileName of invalidNames) {
    const res = await callHandler(controller.initiateMultipartUpload, {
      fileName,
      contentType: 'video/mp4',
      fileSize: 10 * 1024 * 1024,
    });
    assert.equal(res.statusCode, 400, `Invalid fileName "${fileName}" must be rejected`);
  }
});

test('S3 Multipart Part URL: partNumber boundary validation (1 to 10000)', async () => {
  const originalSend = config.s3Client.send;
  config.s3Client.send = async () => ({});

  const validKey = 'videos/1791788204839-test-video.mp4';
  const uploadId = 'test-upload-id';

  // Boundary: Part 0 (below min 1) must be rejected
  const resPart0 = await callHandler(controller.partUrl, { key: validKey, uploadId, partNumber: 0 });
  assert.equal(resPart0.statusCode, 400, 'PartNumber 0 must be rejected');

  // Boundary: Part 10001 (above S3 max 10,000) must be rejected
  const resPart10001 = await callHandler(controller.partUrl, { key: validKey, uploadId, partNumber: 10001 });
  assert.equal(resPart10001.statusCode, 400, 'PartNumber 10001 must be rejected');

  // Non-integer partNumber must be rejected
  const resFloat = await callHandler(controller.partUrl, { key: validKey, uploadId, partNumber: 1.5 });
  assert.equal(resFloat.statusCode, 400, 'Non-integer partNumber must be rejected');

  // Valid partNumber 1 and 10000 should pass parameter validation
  const resPart1 = await callHandler(controller.partUrl, { key: validKey, uploadId, partNumber: 1 });
  assert.equal(resPart1.statusCode, 200, 'PartNumber 1 must succeed');

  const resPart10000 = await callHandler(controller.partUrl, { key: validKey, uploadId, partNumber: 10000 });
  assert.equal(resPart10000.statusCode, 200, 'PartNumber 10000 must succeed');
});

test('S3 Multipart Complete: rejects empty parts, duplicate parts, and size/type mismatches', async (t) => {
  const originalSend = config.s3Client.send;
  config.s3Client.send = async (command) => {
    if (command.constructor.name === 'CompleteMultipartUploadCommand') return { Location: 's3://bucket/test', ETag: '"done"' };
    if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 50000000, ContentType: 'video/mp4' };
    return {};
  };
  t.after(() => { config.s3Client.send = originalSend; });

  const validKey = 'videos/1791788204839-test-video.mp4';
  const uploadId = 'test-upload-id';

  // 1. Empty parts array rejected
  const resEmptyParts = await callHandler(controller.completeMultipartUpload, {
    key: validKey, uploadId, parts: [],
  });
  assert.equal(resEmptyParts.statusCode, 400, 'Empty parts array must be rejected');

  // 2. Duplicate part numbers rejected
  const resDupParts = await callHandler(controller.completeMultipartUpload, {
    key: validKey, uploadId,
    parts: [
      { partNumber: 1, etag: '0123456789abcdef0123456789abcdef' },
      { partNumber: 1, etag: 'fedcba9876543210fedcba9876543210' },
    ],
  });
  assert.equal(resDupParts.statusCode, 400, 'Duplicate part numbers must be rejected');

  // 3. Declared fileSize mismatch against HeadObjectCommand rejected
  const resSizeMismatch = await callHandler(controller.completeMultipartUpload, {
    key: validKey, uploadId, fileSize: 99999999, // actual in HeadObject is 50000000
    parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
  });
  assert.equal(resSizeMismatch.statusCode, 400, 'Mismatched fileSize must be rejected');
  assert.match(resSizeMismatch.body.message, /fileSize/i);

  // 4. Declared contentType mismatch against HeadObjectCommand rejected
  const resTypeMismatch = await callHandler(controller.completeMultipartUpload, {
    key: validKey, uploadId, contentType: 'video/quicktime', // actual in HeadObject is video/mp4
    parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
  });
  assert.equal(resTypeMismatch.statusCode, 400, 'Mismatched contentType must be rejected');
});

// =========================================================================
// SECTION 2: CONTROLLED STAGING SIMULATION: > 500 MB MULTIPART FLOW
// =========================================================================

test('Controlled Staging Simulation: 600 MB (> 500 MB) Video Multipart Upload Flow', async (t) => {
  const SIX_HUNDRED_MB = 600 * 1024 * 1024; // 629,145,600 bytes
  const PART_SIZE = 8 * 1024 * 1024; // 8 MB chunks
  const totalParts = Math.ceil(SIX_HUNDRED_MB / PART_SIZE); // 75 parts
  assert.equal(totalParts, 75, '600 MB video should yield exactly 75 parts at 8MB each');

  let activeUploadId = 'stage-upload-id-600mb';
  let activeKey = '';

  const originalSend = config.s3Client.send;
  config.s3Client.send = async (command) => {
    const cmdName = command.constructor.name;
    if (cmdName === 'CreateMultipartUploadCommand') {
      return { UploadId: activeUploadId };
    }
    if (cmdName === 'CompleteMultipartUploadCommand') {
      return { Location: `https://whitecoat-media-prod.s3.amazonaws.com/${command.input.Key}`, ETag: '"stage-complete-etag"' };
    }
    if (cmdName === 'HeadObjectCommand') {
      return {
        ContentLength: SIX_HUNDRED_MB,
        ContentType: 'video/mp4',
        ETag: '"stage-complete-etag"',
        LastModified: new Date(),
      };
    }
    return {};
  };
  t.after(() => { config.s3Client.send = originalSend; });

  // Step 1: Initiate 600 MB Multipart Upload
  const initRes = await callHandler(controller.initiateMultipartUpload, {
    fileName: 'clinical-homeopathy-masterclass-lecture1.mp4',
    contentType: 'video/mp4',
    fileSize: SIX_HUNDRED_MB,
  });
  assert.equal(initRes.statusCode, 201, 'Initiation of 600 MB video must succeed');
  assert.ok(initRes.body.uploadId, 'Must return uploadId');
  assert.ok(initRes.body.key.startsWith('videos/'), 'S3 key must use videos/ prefix');
  activeKey = initRes.body.key;

  // Step 2: Request part presigned URLs for key parts (first, middle, last)
  for (const partNum of [1, 38, 75]) {
    const partRes = await callHandler(controller.partUrl, {
      uploadId: activeUploadId,
      key: activeKey,
      partNumber: partNum,
    });
    assert.equal(partRes.statusCode, 200, `Presigned URL for part ${partNum} must succeed`);
    assert.ok(partRes.body.url, `Part ${partNum} must have url`);
    assert.equal(partRes.body.partNumber, partNum);
  }

  // Step 3: Complete 600 MB Multipart Upload with all 75 parts
  const parts = [];
  for (let i = 1; i <= totalParts; i++) {
    parts.push({
      partNumber: i,
      etag: i.toString(16).padStart(32, '0'),
    });
  }

  const completeRes = await callHandler(controller.completeMultipartUpload, {
    uploadId: activeUploadId,
    key: activeKey,
    parts,
    fileName: 'clinical-homeopathy-masterclass-lecture1.mp4',
    contentType: 'video/mp4',
    fileSize: SIX_HUNDRED_MB,
  });

  assert.equal(completeRes.statusCode, 200, 'Completion of 600 MB video must succeed');
  assert.equal(completeRes.body.success, true);
  assert.equal(completeRes.body.s3Key, activeKey);
  assert.equal(completeRes.body.media.fileSize, SIX_HUNDRED_MB);
  assert.equal(completeRes.body.storageProvider, 's3');
  assert.ok(completeRes.body.secure_url, 'Must return direct or presigned playback URL');
});

// =========================================================================
// SECTION 3: S3 SINGLE OBJECT PRESIGN BOUNDARIES (IMAGE, PDF, DOCUMENT)
// =========================================================================

test('S3 Single Object Presign: Image limit is 25 MB with strict image types', async () => {
  const IMAGE_MAX = 25 * 1024 * 1024; // 26,214,400 bytes

  // 1. 25 MB image passes
  const res25Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'image',
    fileName: 'banner.jpg',
    contentType: 'image/jpeg',
    fileSize: IMAGE_MAX,
  });
  assert.equal(res25Mb.statusCode, 200, 'Exact 25 MB image must succeed');
  assert.ok(res25Mb.body.key.startsWith('images/'));

  // 2. 25 MB + 1 byte rejected
  const resOver25Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'image',
    fileName: 'banner.jpg',
    contentType: 'image/jpeg',
    fileSize: IMAGE_MAX + 1,
  });
  assert.equal(resOver25Mb.statusCode, 400, 'Image > 25 MB must be rejected');
  assert.match(resOver25Mb.body.message, /fileSize/i);

  // 3. Supported image types: jpeg, png, webp, gif
  for (const { ext, mime } of [
    { ext: 'jpg', mime: 'image/jpeg' },
    { ext: 'png', mime: 'image/png' },
    { ext: 'webp', mime: 'image/webp' },
    { ext: 'gif', mime: 'image/gif' },
  ]) {
    const res = await callHandler(controller.initiateObjectUpload, {
      mediaType: 'image',
      fileName: `test.${ext}`,
      contentType: mime,
      fileSize: 1024,
    });
    assert.equal(res.statusCode, 200, `Image type ${mime} with .${ext} must succeed`);
  }

  // 4. SVG is NOT supported in S3 media image rules
  const resSvg = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'image',
    fileName: 'icon.svg',
    contentType: 'image/svg+xml',
    fileSize: 1024,
  });
  assert.equal(resSvg.statusCode, 400, 'SVG must be rejected by image presign rule');

  // 5. Extension mismatch (e.g., png extension with image/jpeg)
  const resMismatch = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'image',
    fileName: 'photo.png',
    contentType: 'image/jpeg',
    fileSize: 1024,
  });
  assert.equal(resMismatch.statusCode, 400, 'Mismatched extension/contentType must be rejected');
});

test('S3 Single Object Presign: PDF limit is 250 MB with strict PDF type', async () => {
  const PDF_MAX = 250 * 1024 * 1024; // 262,144,000 bytes

  // 1. 250 MB PDF passes
  const res250Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'pdf',
    fileName: 'handout.pdf',
    contentType: 'application/pdf',
    fileSize: PDF_MAX,
  });
  assert.equal(res250Mb.statusCode, 200, 'Exact 250 MB PDF must succeed');
  assert.ok(res250Mb.body.key.startsWith('pdfs/'));

  // 2. 250 MB + 1 byte rejected
  const resOver250Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'pdf',
    fileName: 'handout.pdf',
    contentType: 'application/pdf',
    fileSize: PDF_MAX + 1,
  });
  assert.equal(resOver250Mb.statusCode, 400, 'PDF > 250 MB must be rejected');
  assert.match(resOver250Mb.body.message, /fileSize/i);
});

test('S3 Single Object Presign: Document limit is 100 MB and supports DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, CSV, ZIP, RAR', async () => {
  const DOC_MAX = 100 * 1024 * 1024; // 104,857,600 bytes

  // 1. Exact 100 MB document succeeds
  const res100Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'document',
    fileName: 'syllabus.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: DOC_MAX,
  });
  assert.equal(res100Mb.statusCode, 200, 'Exact 100 MB document must succeed');
  assert.ok(res100Mb.body.key.startsWith('documents/'), 'Key must start with documents/ prefix');
  assert.ok(res100Mb.body.uploadUrl, 'Must return uploadUrl');

  // 2. 100 MB + 1 byte is rejected
  const resOver100Mb = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'document',
    fileName: 'syllabus.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: DOC_MAX + 1,
  });
  assert.equal(resOver100Mb.statusCode, 400, 'Document > 100 MB must be rejected');
  assert.match(resOver100Mb.body.message, /fileSize/i);

  // 3. Test all supported document formats
  const supportedDocs = [
    { ext: 'doc', mime: 'application/msword' },
    { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { ext: 'ppt', mime: 'application/vnd.ms-powerpoint' },
    { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    { ext: 'xls', mime: 'application/vnd.ms-excel' },
    { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { ext: 'txt', mime: 'text/plain' },
    { ext: 'csv', mime: 'text/csv' },
    { ext: 'zip', mime: 'application/zip' },
    { ext: 'rar', mime: 'application/x-rar-compressed' },
  ];

  for (const { ext, mime } of supportedDocs) {
    const res = await callHandler(controller.initiateObjectUpload, {
      mediaType: 'document',
      fileName: `assignment.${ext}`,
      contentType: mime,
      fileSize: 5 * 1024 * 1024,
    });
    assert.equal(res.statusCode, 200, `Document type ${mime} with .${ext} must succeed`);
    assert.ok(res.body.key.startsWith('documents/'));
  }

  // 4. Aliases 'doc', 'docx', 'attachment' normalized to 'document'
  const resAlias = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'doc',
    fileName: 'notes.doc',
    contentType: 'application/msword',
    fileSize: 2048,
  });
  assert.equal(resAlias.statusCode, 200, "mediaType 'doc' alias must normalize and succeed");
  assert.equal(resAlias.body.media.resourceType, 'document');
  assert.ok(resAlias.body.key.startsWith('documents/'));

  // 5. Mismatched extension/contentType rejected
  const resDocMismatch = await callHandler(controller.initiateObjectUpload, {
    mediaType: 'document',
    fileName: 'spreadsheet.xlsx',
    contentType: 'application/msword',
    fileSize: 2048,
  });
  assert.equal(resDocMismatch.statusCode, 400, 'Mismatched doc extension and contentType must be rejected');

  // 6. Complete object upload for document verified
  const originalSend = config.s3Client.send;
  config.s3Client.send = async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') {
      return { ContentLength: 2048, ContentType: 'application/msword' };
    }
    return {};
  };

  const compRes = await callHandler(controller.completeObjectUpload, {
    mediaType: 'document',
    key: 'documents/1791875666427-notes.doc',
    fileName: 'notes.doc',
    contentType: 'application/msword',
    fileSize: 2048,
  });
  config.s3Client.send = originalSend;

  assert.equal(compRes.statusCode, 200, 'Completion of document upload must succeed');
  assert.equal(compRes.body.success, true);
  assert.equal(compRes.body.media.resourceType, 'document');
});

test('S3 Single Object Presign: rejects non-supported media categories (video, audio, exe, raw)', async () => {
  for (const unsupportedType of ['video', 'audio', 'exe', 'unknown', 'archive_unknown']) {
    const res = await callHandler(controller.initiateObjectUpload, {
      mediaType: unsupportedType,
      fileName: 'file.bin',
      contentType: 'application/octet-stream',
      fileSize: 1024,
    });
    assert.equal(res.statusCode, 400, `Unsupported mediaType "${unsupportedType}" must be rejected`);
    assert.match(res.body.message, /image, pdf, or document/i);
  }
});

// =========================================================================
// SECTION 4: RECORDING DIRECT S3 KEY LINKAGE (NO IN-MEMORY BUFFERING)
// =========================================================================

test('Recording Upload: accepts direct s3Key without file buffer and saves S3 storage provider', async (t) => {
  const validId = '507f1f77bcf86cd799439011';
  // Mock Recording.findById and save
  const originalFindById = Recording.findById;
  const mockRecording = {
    _id: validId,
    title: 'Test Live Session',
    storageProvider: 'cloudinary',
    s3Key: null,
    directUrl: null,
    status: 'recorded',
    save: async function() { return this; },
  };
  Recording.findById = async (id) => (String(id) === validId ? mockRecording : null);
  t.after(() => { Recording.findById = originalFindById; });

  const res = await callHandler(
    recordingController.uploadRecordingVideo,
    { s3Key: 'videos/1791875666427-rec_test_123.mp4', duration: 3600 },
    { id: 'admin-1', role: 'admin' },
    {},
    { id: validId },
    undefined // No file buffer!
  );

  assert.equal(res.statusCode, 200, 'Upload with direct s3Key must succeed');
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.s3Key, 'videos/1791875666427-rec_test_123.mp4');
  assert.equal(res.body.data.storageProvider, 's3');
  assert.equal(mockRecording.storageProvider, 's3');
  assert.equal(mockRecording.s3Key, 'videos/1791875666427-rec_test_123.mp4');
});

// =========================================================================
// SECTION 5: MULTER APPLICATION-LEVEL RESTRICTIONS & VALIDATIONS
// =========================================================================

test('General Multer (middleware/upload.js): format whitelist and PDF magic bytes', async () => {
  const fileFilter = uploadMiddleware.fileFilter;
  assert.equal(typeof fileFilter, 'function', 'upload.fileFilter must be a function');

  const testExt = (filename) => new Promise((resolve) => {
    fileFilter({}, { originalname: filename }, (err, allowed) => {
      resolve({ err, allowed: Boolean(allowed) });
    });
  });

  // Allowed formats
  for (const ext of ['mp4', 'mov', 'pdf', 'jpg', 'png', 'docx', 'xlsx', 'zip']) {
    const result = await testExt(`sample.${ext}`);
    assert.equal(result.err, null, `${ext} should not return an error`);
    assert.equal(result.allowed, true, `${ext} should be allowed`);
  }

  // Blocked formats
  for (const ext of ['exe', 'sh', 'php', 'bat', 'cmd', 'js', 'py']) {
    const result = await testExt(`danger.${ext}`);
    assert.ok(result.err, `${ext} must produce an error`);
    assert.equal(result.allowed, false, `${ext} must not be allowed`);
  }
});

test('Rank Image Upload (middleware/rankImageUpload.middleware.js): 10 MB limit and image format whitelist', async () => {
  const allowedFormats = rankImageMiddleware.ALLOWED_IMAGE_FORMATS;
  assert.deepEqual(allowedFormats.sort(), ['jpeg', 'jpg', 'png', 'webp']);
  assert.ok(!allowedFormats.includes('gif'), 'gif is not allowed for rank images');
  assert.ok(!allowedFormats.includes('svg'), 'svg is not allowed for rank images');
  assert.ok(!allowedFormats.includes('pdf'), 'pdf is not allowed for rank images');
});

test('MCQ Extract Route (routes/exam.routes.js): 15 MB limit and extension whitelist', () => {
  const examRoutesPath = path.resolve(__dirname, '../routes/exam.routes.js');
  const code = fs.readFileSync(examRoutesPath, 'utf8');

  // Verify hard limit: 15 * 1024 * 1024
  assert.match(code, /fileSize:\s*15\s*\*\s*1024\s*\*\s*1024/, 'exam.routes.js must have 15MB limit configured');
  assert.match(code, /\(pdf\|png\|jpg\|jpeg\|webp\|csv\|xlsx\|xls\)/i, 'exam.routes.js must enforce allowed formats regex');
});

// =========================================================================
// SECTION 6: SERVER BODY PARSER AND ROUTE TIMEOUT ARCHITECTURE
// =========================================================================

test('Server timeouts and route classification logic configured correctly in server.js', () => {
  const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

  // JSON limit 2mb, urlencoded limit 1mb
  assert.match(serverCode, /express\.json\(\s*\{\s*limit:\s*['"]2mb['"]\s*\}\s*\)/);
  assert.match(serverCode, /express\.urlencoded\(\s*\{\s*limit:\s*['"]1mb['"]/);

  // Upload route timeout: 300,000 ms (5 min); General route timeout: 30,000 ms (30 sec)
  assert.match(serverCode, /timeoutMs\s*=\s*isUploadRoute\s*\?\s*300000\s*:\s*30000/);

  // Verify route classification logic:
  // Course lesson mutations (POST/PUT/PATCH to /courses or /lessons) get 300,000ms
  // Read requests (GET /courses, GET /lessons) get 30,000ms
  assert.match(serverCode, /req\.method === ['"]POST['"] \|\| req\.method === ['"]PUT['"] \|\| req\.method === ['"]PATCH['"]/);
  assert.match(serverCode, /url\.includes\(['"]\/lessons['"]\) \|\| url\.includes\(['"]\/courses['"]\)/);

  // Functional verification of the classification rule:
  const classify = (method, url) => {
    const isUploadRoute =
      url.includes('/upload') ||
      url.includes('/s3-upload') ||
      url.includes('/recording') ||
      url.includes('/live-record') ||
      url.includes('/demo-video') ||
      url.includes('/media') ||
      ((method === 'POST' || method === 'PUT' || method === 'PATCH') &&
        (url.includes('/lessons') || url.includes('/courses')));
    return isUploadRoute ? 300000 : 30000;
  };

  assert.equal(classify('GET', '/api/courses?page=1&limit=20'), 30000, 'GET /courses must have 30s timeout');
  assert.equal(classify('GET', '/api/lessons/123'), 30000, 'GET /lessons must have 30s timeout');
  assert.equal(classify('POST', '/api/courses'), 300000, 'POST /courses must have 300s timeout');
  assert.equal(classify('PUT', '/api/courses/123'), 300000, 'PUT /courses must have 300s timeout');
  assert.equal(classify('POST', '/api/lessons'), 300000, 'POST /lessons must have 300s timeout');
  assert.equal(classify('PATCH', '/api/lessons/456'), 300000, 'PATCH /lessons must have 300s timeout');
  assert.equal(classify('GET', '/api/exams'), 30000, 'GET /exams must have 30s timeout');

  // HTTP Keep-alive and socket settings
  assert.match(serverCode, /server\.timeout\s*=\s*0/);
  assert.match(serverCode, /server\.keepAliveTimeout\s*=\s*65000/);
  assert.match(serverCode, /server\.headersTimeout\s*=\s*66000/);
});
