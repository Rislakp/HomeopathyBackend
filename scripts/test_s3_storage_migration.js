/**
 * Comprehensive S3 Storage Migration Test Suite
 */
const mongoose = require('mongoose');
const http = require('http');
const jwt = require('jsonwebtoken');
const { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING AWS S3 STORAGE MIGRATION TEST SUITE');
  console.log('====================================================\n');

  // 1. Check S3 service exports & configuration
  const s3Config = require('../config/s3');
  const s3Service = require('../services/s3Service');
  const s3UploadService = require('../utils/s3UploadService');

  console.log('--- Test 1: S3 Service & Config Initialization ---');
  if (typeof s3Service.uploadBufferToS3 === 'function' &&
      typeof s3Service.deleteFile === 'function' &&
      typeof s3Service.getS3KeyFromUrl === 'function' &&
      typeof s3Service.getS3Url === 'function') {
    console.log('✅ PASS: s3Service exports all required methods');
  } else {
    throw new Error('s3Service missing required methods');
  }

  if (s3UploadService === s3Service) {
    console.log('✅ PASS: utils/s3UploadService correctly re-exports services/s3Service');
  } else {
    throw new Error('s3UploadService does not re-export s3Service');
  }

  console.log('Region:', s3Config.region);
  console.log('Bucket:', s3Config.bucket);
  console.log('isS3Configured:', s3Service.isS3Configured());

  // 2. URL parsing & construction test
  console.log('\n--- Test 2: S3 URL Construction & Key Extraction ---');
  const sampleKey = 'images/2026-dr-fatima-begum.png';
  const expectedUrl = `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${sampleKey}`;
  const generatedUrl = s3Service.getS3Url(sampleKey);

  if (generatedUrl === expectedUrl) {
    console.log('✅ PASS: Generated public S3 URL matches virtual-host convention');
  } else {
    throw new Error(`Expected URL ${expectedUrl}, got ${generatedUrl}`);
  }

  const extractedKey = s3Service.getS3KeyFromUrl(generatedUrl);
  if (extractedKey === sampleKey) {
    console.log('✅ PASS: Successfully extracted S3 object key from full URL:', extractedKey);
  } else {
    throw new Error(`Expected key ${sampleKey}, got ${extractedKey}`);
  }

  // 3. Mock S3 client commands for automated local integration tests
  console.log('\n--- Test 3: S3 Command Payload Verification ---');
  const originalSend = s3Config.s3Client.send;
  const sentCommands = [];
  s3Config.s3Client.send = async (command) => {
    sentCommands.push(command);
    if (command instanceof PutObjectCommand) {
      return { ETag: '"test-etag-123"' };
    }
    if (command instanceof DeleteObjectCommand) {
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: 67, ContentType: 'image/png' };
    }
    return {};
  };

  try {
    const testBuffer = Buffer.from('FAKE_PNG_IMAGE_DATA_12345');
    const uploadRes = await s3Service.uploadBufferToS3(testBuffer, {
      originalname: 'test_rank_holder.png',
      mimetype: 'image/png',
      folder: 'ranks',
    });

    if (uploadRes.secure_url && uploadRes.key && uploadRes.key.startsWith('ranks/')) {
      console.log('✅ PASS: uploadBufferToS3 succeeded with key:', uploadRes.key);
      console.log('✅ PASS: Returned secure_url:', uploadRes.secure_url);
    } else {
      throw new Error(`Invalid upload response: ${JSON.stringify(uploadRes)}`);
    }

    // Verify S3 PutObjectCommand was sent with correct parameters
    const putCmd = sentCommands.find((c) => c instanceof PutObjectCommand);
    if (putCmd && putCmd.input.Bucket === s3Config.bucket && putCmd.input.ContentType === 'image/png') {
      console.log('✅ PASS: PutObjectCommand dispatched with Bucket, Key, and ContentType');
    } else {
      throw new Error('PutObjectCommand not dispatched correctly');
    }

    // Test deleteFile
    const deleteRes = await s3Service.deleteFile(uploadRes.secure_url);
    if (deleteRes.success && deleteRes.key === uploadRes.key) {
      console.log('✅ PASS: deleteFile dispatched DeleteObjectCommand for key:', deleteRes.key);
    } else {
      throw new Error('deleteFile failed');
    }

    const delCmd = sentCommands.find((c) => c instanceof DeleteObjectCommand);
    if (delCmd && delCmd.input.Bucket === s3Config.bucket && delCmd.input.Key === uploadRes.key) {
      console.log('✅ PASS: DeleteObjectCommand confirmed for S3 key');
    } else {
      throw new Error('DeleteObjectCommand input mismatch');
    }

    // 4. Connect MongoDB & start test server
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whitecoat';
    await mongoose.connect(mongoUri);
    console.log('\n✅ Connected to MongoDB');

    const UnaniRank = require('../src/unani/ranks/models/unaniRank.model');
    const User = require('../models/User');

    // Clean test ranks
    await UnaniRank.deleteMany({ name: { $regex: /^__S3_TEST__/i } });

    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.create({
        name: '__S3_TEST__ Admin',
        email: '__s3_test_admin@test.com',
        password: 'password123',
        role: 'admin',
      });
    }
    const adminToken = jwt.sign(
      { userId: adminUser._id.toString(), id: adminUser._id.toString(), role: 'admin', email: adminUser.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const { app } = require('../server');
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`📡 Test Server running on ${baseUrl}\n`);

    async function apiRequest(method, endpoint, body = null, token = null) {
      const url = `${baseUrl}${endpoint}`;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // 5. Test Generic Upload API via HTTP Multipart
    console.log('--- Test 4: POST /api/upload (Generic Upload Endpoint) ---');
    const validPngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d0000000049454e44ae426082', 'hex');
    const formData = new FormData();
    const fileBlob = new Blob([validPngBytes], { type: 'image/png' });
    formData.append('file', fileBlob, 'dr_fatima_begum.png');
    formData.append('folder', 'ranks');

    const uploadHttpRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: formData,
    });
    const uploadJson = await uploadHttpRes.json();

    if (uploadHttpRes.status === 200 && uploadJson.success && uploadJson.secure_url) {
      console.log('✅ PASS: POST /api/upload succeeded (Status 200)');
      console.log('✅ PASS: secure_url:', uploadJson.secure_url);
      console.log('✅ PASS: public_id / key:', uploadJson.public_id || uploadJson.key);
      console.log('✅ PASS: Storage Provider:', uploadJson.storageProvider || 's3');
    } else {
      throw new Error(`Upload failed: status=${uploadHttpRes.status}, data=${JSON.stringify(uploadJson)}`);
    }

    const s3ImageUrl = uploadJson.secure_url;

    // 6. Test Unani Rank Holder Flow with S3 Image URL
    console.log('\n--- Test 5: Create Unani Rank Holder with S3 Image URL ---');
    const rankRes = await apiRequest(
      'POST',
      '/api/admin/unani/ranks',
      {
        name: '__S3_TEST__ Dr. Fatima Begum',
        examName: 'AIAPGET',
        rankLabel: 'AIR 07',
        year: 2025,
        category: 'AIAPGET',
        score: 380,
        percentage: 95.0,
        profileImage: s3ImageUrl,
        description: 'S3-stored image rank holder card',
        displayOrder: 1,
        isActive: true,
      },
      adminToken
    );

    let createdRankId = null;
    if (rankRes.status === 201 && rankRes.data.success && rankRes.data.data.profileImage === s3ImageUrl) {
      createdRankId = rankRes.data.data.id;
      console.log(`✅ PASS: Unani Rank created with S3 Image URL (ID: ${createdRankId})`);
      console.log(`✅ PASS: profileImage stored as URL: ${rankRes.data.data.profileImage}`);
    } else {
      throw new Error(`Unani Rank creation failed: ${JSON.stringify(rankRes.data)}`);
    }

    // 7. Verify Public GET /api/unani/ranks returns S3 image URL
    console.log('\n--- Test 6: GET /api/unani/ranks (Public Card Display) ---');
    const publicRanks = await apiRequest('GET', '/api/unani/ranks', null, null);
    if (publicRanks.status === 200 && publicRanks.data.success) {
      const foundCard = publicRanks.data.data.find((r) => r.id === createdRankId);
      if (foundCard && foundCard.profileImage === s3ImageUrl) {
        console.log('✅ PASS: Public Rank Card displays S3 image URL cleanly:', foundCard.profileImage);
      } else {
        throw new Error('S3 Rank Card not found or image URL mismatch in public endpoint');
      }
    } else {
      throw new Error(`Public ranks fetch failed: ${publicRanks.status}`);
    }

    // 8. Test Cloudinary URL Preservation in Database
    console.log('\n--- Test 7: Cloudinary Backward Compatibility in MongoDB ---');
    const legacyCloudinaryUrl = 'https://res.cloudinary.com/example_cloud/image/upload/v12345/homeopathy-media/dr_legacy.jpg';
    const legacyRank = await UnaniRank.create({
      name: '__S3_TEST__ Dr. Legacy Cloudinary Holder',
      examName: 'AIAPGET',
      rankLabel: 'AIR 01',
      year: 2024,
      profileImage: legacyCloudinaryUrl,
      displayOrder: 2,
      isActive: true,
      courseId: 'unani',
    });

    const getLegacy = await apiRequest('GET', `/api/admin/unani/ranks/${legacyRank._id}`, null, adminToken);
    if (getLegacy.status === 200 && getLegacy.data.data.profileImage === legacyCloudinaryUrl) {
      console.log('✅ PASS: Existing Cloudinary URLs in database are 100% preserved and returned untouched');
    } else {
      throw new Error('Cloudinary URL was modified or corrupted');
    }

    // 9. Test DELETE /api/upload
    console.log('\n--- Test 8: DELETE /api/upload File Deletion ---');
    const deleteUploadRes = await apiRequest(
      'DELETE',
      '/api/upload',
      { url: s3ImageUrl, key: uploadJson.public_id },
      adminToken
    );
    if (deleteUploadRes.status === 200 && deleteUploadRes.data.success) {
      console.log('✅ PASS: DELETE /api/upload accepted deletion request successfully');
    } else {
      throw new Error(`DELETE /api/upload failed: ${JSON.stringify(deleteUploadRes.data)}`);
    }

    // Clean up test data
    await UnaniRank.deleteMany({ name: { $regex: /^__S3_TEST__/i } });
    await User.deleteMany({ email: '__s3_test_admin@test.com' });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    console.log('🧹 Cleanup completed.');

    console.log('\n====================================================');
    console.log('🎉 ALL S3 STORAGE MIGRATION TESTS PASSED CLEANLY!');
    console.log('====================================================\n');
  } finally {
    s3Config.s3Client.send = originalSend;
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILURE:', err);
  process.exit(1);
});
