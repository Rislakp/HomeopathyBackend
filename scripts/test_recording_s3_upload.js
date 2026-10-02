const assert = require('assert');
const mongoose = require('mongoose');
const recordingController = require('../controllers/recordingController');
const s3UploadController = require('../controllers/s3UploadController');
const Recording = require('../models/Recording');
const Course = require('../models/Course');
const s3Service = require('../services/s3Service');
const config = require('../config/s3');

// Helper to mock res
const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

async function runTests() {
  console.log('🧪 Starting Live Records S3 Upload and Retrieval Verification Tests...\n');

  // Synthetic S3 client configuration for testing
  const originalCredentials = config.s3Client.config.credentials;
  config.s3Client.config.credentials = async () => ({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'test-secret-key-12345',
  });

  // Mock s3Service.uploadFile
  const originalUploadFile = s3Service.uploadFile;
  s3Service.uploadFile = async (file, folder, options = {}) => {
    const key = `${folder}/${Date.now()}-mock-${file.originalname || 'rec.mp4'}`;
    const url = `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
    return {
      key,
      s3Key: key,
      public_id: key,
      secure_url: url,
      secureUrl: url,
      url,
      fileUrl: url,
      documentUrl: url,
      path: url,
      title: file.originalname || 'rec.mp4',
      fileName: file.originalname || 'rec.mp4',
      bytes: file.buffer?.length || 1024,
      size: file.buffer?.length || 1024,
      fileSize: file.buffer?.length || 1024,
      mimetype: file.mimetype || 'video/mp4',
      contentType: file.mimetype || 'video/mp4',
      resource_type: 'video',
      resourceType: 'video',
      format: 'mp4',
      storageProvider: 's3',
    };
  };

  try {
    // -------------------------------------------------------------
    // Test 1: Create a recording session entry (POST /api/recordings)
    // -------------------------------------------------------------
    console.log('Test 1: Create recording session');
    const recId = new mongoose.Types.ObjectId();
    const mockRecordingDoc = new Recording({
      _id: recId,
      courseName: 'Homeopathy Materia Medica',
      moduleName: 'Module 1',
      lessonTitle: 'Lesson 1: Introduction',
      streamUrl: 'https://meet.google.com/abc-defg-hij',
      liveClassUrl: 'https://meet.google.com/abc-defg-hij',
      status: 'pending',
    });

    // Mock Recording.findById and Recording.prototype.save
    const origFindById = Recording.findById;
    const origFind = Recording.find;
    const origCount = Recording.countDocuments;
    const origFindOne = Recording.findOne;
    const origCourseFindOne = Course.findOne;

    Recording.findById = async (id) => {
      if (id.toString() === recId.toString()) return mockRecordingDoc;
      return null;
    };
    mockRecordingDoc.save = async function() { return this; };

    console.log('  ✅ Recording session model initialized');

    // -------------------------------------------------------------
    // Test 2: Upload recorded video to S3 via uploadRecordingVideo
    // -------------------------------------------------------------
    console.log('\nTest 2: Upload recorded video to S3 (POST /api/recordings/:id/upload)');
    const req = {
      params: { id: recId.toString() },
      body: {
        status: 'stopped',
        duration: '15:30',
        width: 1920,
        height: 1080,
      },
      file: {
        originalname: 'live-recording-sample.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.from('fake-video-content-stream-bytes'),
      },
    };
    const res = makeResponse();

    await recordingController.uploadRecordingVideo(req, res);

    assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.message, 'Recording uploaded successfully');

    // Check ALL required media URL fields at top level
    assert.ok(res.body.secure_url, 'Top-level secure_url is required');
    assert.ok(res.body.secureUrl, 'Top-level secureUrl is required');
    assert.ok(res.body.url, 'Top-level url is required');
    assert.ok(res.body.videoUrl, 'Top-level videoUrl is required');
    assert.ok(res.body.fileUrl, 'Top-level fileUrl is required');
    assert.ok(res.body.recordedVideoUrl, 'Top-level recordedVideoUrl is required');
    assert.ok(res.body.recordingFileUrl, 'Top-level recordingFileUrl is required');
    assert.ok(res.body.s3Key, 'Top-level s3Key is required');
    assert.strictEqual(res.body.storageProvider, 's3');

    // Check ALL required media URL fields inside data
    assert.ok(res.body.data, 'res.body.data is required');
    assert.ok(res.body.data.secure_url, 'data.secure_url is required');
    assert.ok(res.body.data.url, 'data.url is required');
    assert.ok(res.body.data.videoUrl, 'data.videoUrl is required');
    assert.ok(res.body.data.recordedVideoUrl, 'data.recordedVideoUrl is required');
    assert.ok(res.body.data.s3Key, 'data.s3Key is required');
    assert.strictEqual(res.body.data.storageProvider, 's3');

    // Confirm URL is an S3 signed URL or HTTPS S3 URL (NOT Cloudinary)
    assert.ok(
      res.body.secure_url.includes('amazonaws.com') || res.body.secure_url.includes('X-Amz-Signature='),
      'Must be AWS S3 URL'
    );
    assert.strictEqual(
      res.body.secure_url.includes('cloudinary.com'),
      false,
      'New upload must NOT be a Cloudinary URL'
    );

    // Confirm MongoDB document was updated
    assert.ok(mockRecordingDoc.recordedVideoUrl.includes('amazonaws.com'));
    assert.ok(mockRecordingDoc.s3Key.startsWith('videos/'));
    assert.strictEqual(mockRecordingDoc.storageProvider, 's3');
    assert.strictEqual(mockRecordingDoc.status, 'stopped');
    assert.strictEqual(mockRecordingDoc.duration, '15:30');

    console.log('  ✅ HTTP 200 returned');
    console.log('  ✅ Standard media fields present at root and data (secure_url, url, videoUrl, s3Key, etc.)');
    console.log(`  ✅ S3 URL: ${res.body.secure_url.slice(0, 70)}...`);
    console.log(`  ✅ S3 key saved in MongoDB: ${mockRecordingDoc.s3Key}`);

    // -------------------------------------------------------------
    // Test 3: Existing Cloudinary recordings are preserved
    // -------------------------------------------------------------
    console.log('\nTest 3: Existing Cloudinary recordings preservation');
    const legacyCloudinaryRec = new Recording({
      _id: new mongoose.Types.ObjectId(),
      courseName: 'Organon of Medicine',
      moduleName: 'Aphorisms 1-10',
      lessonTitle: 'The Physician\'s Mission',
      recordedVideoUrl: 'https://res.cloudinary.com/vadgpisw/video/upload/v123456/legacy-rec.mp4',
      recordingFileUrl: 'https://res.cloudinary.com/vadgpisw/video/upload/v123456/legacy-rec.mp4',
      storageProvider: 'cloudinary',
      status: 'completed',
    });

    Recording.findById = async (id) => {
      if (id.toString() === legacyCloudinaryRec._id.toString()) return legacyCloudinaryRec;
      return null;
    };

    const getRes = makeResponse();
    await recordingController.getRecordingById({ params: { id: legacyCloudinaryRec._id.toString() } }, getRes);

    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(
      getRes.body.data.recordedVideoUrl,
      'https://res.cloudinary.com/vadgpisw/video/upload/v123456/legacy-rec.mp4',
      'Cloudinary URL must remain untouched'
    );
    assert.strictEqual(
      getRes.body.data.secure_url,
      'https://res.cloudinary.com/vadgpisw/video/upload/v123456/legacy-rec.mp4'
    );
    assert.strictEqual(getRes.body.data.storageProvider, 'cloudinary');
    console.log('  ✅ Existing Cloudinary URL preserved intact');

    // -------------------------------------------------------------
    // Test 4: Live Records list view (GET /api/recordings)
    // -------------------------------------------------------------
    console.log('\nTest 4: Live Records list view (GET /api/recordings / GET /api/live-records)');
    Recording.countDocuments = async () => 2;
    Recording.find = () => ({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: async () => [mockRecordingDoc.toObject(), legacyCloudinaryRec.toObject()],
            }),
          }),
        }),
      }),
    });

    const listRes = makeResponse();
    await recordingController.getRecordings({ query: {}, user: { role: 'admin' } }, listRes);

    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.body.count, 2);
    assert.ok(listRes.body.data[0].secure_url, 'S3 item must have secure_url');
    assert.ok(listRes.body.data[0].videoUrl, 'S3 item must have videoUrl');
    assert.strictEqual(listRes.body.data[1].secure_url, 'https://res.cloudinary.com/vadgpisw/video/upload/v123456/legacy-rec.mp4');
    console.log('  ✅ Both S3 recording and legacy Cloudinary recording displayed correctly in list');

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Test 5: S3 media access-url resolution for the recording
    // -------------------------------------------------------------
    console.log('\nTest 5: S3 media access-url resolution (/api/s3-upload/media/access-url)');
    Course.findOne = async () => null;
    Recording.findOne = async (query) => {
      if (query.$or) {
        const matchesKey = query.$or.some(q => q.s3Key === mockRecordingDoc.s3Key || q.recordedVideoUrl);
        if (matchesKey) return mockRecordingDoc;
      }
      return null;
    };

    const accessRes = makeResponse();
    await s3UploadController.getMediaAccessUrl(
      { query: { s3Key: mockRecordingDoc.s3Key }, user: { role: 'admin' } },
      accessRes
    );

    assert.strictEqual(accessRes.statusCode, 200);
    assert.strictEqual(accessRes.body.success, true);
    assert.strictEqual(accessRes.body.s3Key, mockRecordingDoc.s3Key);
    assert.match(accessRes.body.url, /X-Amz-Signature=/);
    console.log('  ✅ Recording S3 key successfully resolves to signed SigV4 playback URL');

    // -------------------------------------------------------------
    // Test 6: Multipart S3 upload completion with recordingId link
    // -------------------------------------------------------------
    console.log('\nTest 6: S3 Multipart upload completion with recordingId link');
    const originalSend = config.s3Client.send;
    const multipartRecDoc = new Recording({
      _id: new mongoose.Types.ObjectId(),
      courseName: 'Organon Advanced',
      lessonTitle: 'Large Live Class',
      status: 'recording',
    });
    multipartRecDoc.save = async function() { return this; };
    Recording.findById = async (id) => {
      if (id.toString() === multipartRecDoc._id.toString()) return multipartRecDoc;
      return null;
    };

    config.s3Client.send = async (command) => {
      if (command.constructor.name === 'CompleteMultipartUploadCommand') {
        return {
          Location: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/videos/1790934552987-multipart-rec.mp4',
          ETag: '"mock-multipart-etag"',
        };
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 50 * 1024 * 1024, ContentType: 'video/mp4' };
      }
      return originalSend.call(config.s3Client, command);
    };

    const multipartCompleteRes = makeResponse();
    await s3UploadController.completeMultipartUpload({
      body: {
        uploadId: 'mock-upload-id-12345',
        key: 'videos/1790934552987-multipart-rec.mp4',
        parts: [{ partNumber: 1, etag: '0123456789abcdef0123456789abcdef' }],
        recordingId: multipartRecDoc._id.toString(),
      },
      user: { id: 'admin-1', role: 'admin' },
    }, multipartCompleteRes);

    assert.strictEqual(multipartCompleteRes.statusCode, 200);
    assert.strictEqual(multipartCompleteRes.body.success, true);
    assert.strictEqual(multipartCompleteRes.body.storageProvider, 's3');
    assert.strictEqual(multipartCompleteRes.body.s3Key, 'videos/1790934552987-multipart-rec.mp4');
    assert.strictEqual(multipartRecDoc.s3Key, 'videos/1790934552987-multipart-rec.mp4');
    assert.strictEqual(multipartRecDoc.storageProvider, 's3');
    assert.strictEqual(multipartRecDoc.status, 'stopped');
    assert.strictEqual(multipartRecDoc.bytes, 50 * 1024 * 1024);
    config.s3Client.send = originalSend;
    console.log('  ✅ Large recording linked via S3 multipart completion flow');

    // Cleanup
    Recording.findById = origFindById;
    Recording.find = origFind;
    Recording.countDocuments = origCount;
    Recording.findOne = origFindOne;
    Course.findOne = origCourseFindOne;

    console.log('\n🎉 ALL LIVE RECORDINGS S3 UPLOAD & RETRIEVAL TESTS PASSED!\n');
  } finally {
    s3Service.uploadFile = originalUploadFile;
    config.s3Client.config.credentials = originalCredentials;
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
