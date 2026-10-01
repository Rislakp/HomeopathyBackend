/**
 * Comprehensive Test Suite for Independent Unani Rank Module
 */
const mongoose = require('mongoose');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING UNANI INDEPENDENT RANK MODULE TEST SUITE');
  console.log('====================================================\n');

  // 1. Connect Mongoose
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whitecoat';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  // Load models
  const UnaniRank = require('../src/unani/ranks/models/unaniRank.model');
  const User = require('../models/User');

  // Clean up any previous test ranks
  await UnaniRank.deleteMany({ name: { $regex: /^__TEST__/i } });

  // 2. Prepare tokens
  // Admin token
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await User.create({
      name: '__TEST__ Admin',
      email: '__test_admin_rank@test.com',
      password: 'password123',
      role: 'admin',
    });
  }
  const adminToken = jwt.sign(
    { userId: adminUser._id.toString(), id: adminUser._id.toString(), role: 'admin', email: adminUser.email },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Student token
  let studentUser = await User.findOne({ role: 'student' });
  if (!studentUser) {
    studentUser = await User.create({
      name: '__TEST__ Student',
      email: '__test_student_rank@test.com',
      password: 'password123',
      role: 'student',
    });
  }
  const studentToken = jwt.sign(
    { userId: studentUser._id.toString(), id: studentUser._id.toString(), role: 'student', email: studentUser.email },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // 3. Start Express server instance on ephemeral port
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

  let testRankId1 = null;
  let testRankId2 = null;
  let testRankId3Inactive = null;

  try {
    // ----------------------------------------------------
    // Test 1: Authentication enforcement
    // ----------------------------------------------------
    console.log('--- Test 1: POST /api/admin/unani/ranks without token (401) ---');
    const authFailRes = await apiRequest('POST', '/api/admin/unani/ranks', { name: '__TEST__ No Token' });
    if (authFailRes.status === 401) {
      console.log('✅ PASS: Unauthorized access blocked with 401');
    } else {
      throw new Error(`Expected 401, got ${authFailRes.status}`);
    }

    console.log('--- Test 2: POST /api/admin/unani/ranks with Student token (403) ---');
    const studFailRes = await apiRequest('POST', '/api/admin/unani/ranks', { name: '__TEST__ Student Forbidden' }, studentToken);
    if (studFailRes.status === 403) {
      console.log('✅ PASS: Student role blocked with 403');
    } else {
      throw new Error(`Expected 403, got ${studFailRes.status}`);
    }

    // ----------------------------------------------------
    // Test 3: Create Rank Holders (Admin)
    // ----------------------------------------------------
    console.log('\n--- Test 3: POST /api/admin/unani/ranks Create Rank 1 ---');
    const createRes1 = await apiRequest(
      'POST',
      '/api/admin/unani/ranks',
      {
        name: '__TEST__ Dr. Fatima Begum',
        examName: 'AIAPGET',
        rankLabel: 'AIR 07',
        year: 2025,
        category: 'AIAPGET',
        score: 380,
        percentage: 95.0,
        profileImage: 'https://example.com/dr_fatima.jpg',
        description: 'First rank holder in AIAPGET Unani stream',
        displayOrder: 1,
        isActive: true,
      },
      adminToken
    );
    if (createRes1.status === 201 && createRes1.data.success && createRes1.data.data.id) {
      testRankId1 = createRes1.data.data.id;
      console.log(`✅ PASS: Created Rank 1 with ID: ${testRankId1}`);
      // Check NO examId is required or present
      if (createRes1.data.data.examId === undefined && createRes1.data.data.unaniExamId === undefined) {
        console.log('✅ PASS: Strictly independent - NO examId present');
      } else {
        throw new Error('examId should not exist on independent rank');
      }
    } else {
      throw new Error(`Create Rank 1 failed: status=${createRes1.status}, data=${JSON.stringify(createRes1.data)}`);
    }

    console.log('\n--- Test 4: POST /api/admin/unani/ranks Create Rank 2 ---');
    const createRes2 = await apiRequest(
      'POST',
      '/api/admin/unani/ranks',
      {
        name: '__TEST__ Dr. Mohammed Adil',
        examName: 'AIAPGET',
        rankLabel: 'AIR 14',
        year: 2025,
        category: 'AIAPGET',
        score: 365,
        percentage: 91.25,
        profileImage: 'https://example.com/dr_adil.jpg',
        description: 'Second rank holder',
        displayOrder: 2,
        isActive: true,
      },
      adminToken
    );
    if (createRes2.status === 201 && createRes2.data.success) {
      testRankId2 = createRes2.data.data.id;
      console.log(`✅ PASS: Created Rank 2 with ID: ${testRankId2}`);
    } else {
      throw new Error(`Create Rank 2 failed: status=${createRes2.status}`);
    }

    console.log('\n--- Test 5: POST /api/admin/unani/ranks Create Inactive Rank 3 ---');
    const createRes3 = await apiRequest(
      'POST',
      '/api/admin/unani/ranks',
      {
        name: '__TEST__ Dr. Inactive Candidate',
        examName: 'AIAPGET',
        rankLabel: 'AIR 99',
        year: 2024,
        displayOrder: 3,
        isActive: false,
      },
      adminToken
    );
    if (createRes3.status === 201 && createRes3.data.success) {
      testRankId3Inactive = createRes3.data.data.id;
      console.log(`✅ PASS: Created Inactive Rank 3 with ID: ${testRankId3Inactive}`);
    } else {
      throw new Error(`Create Rank 3 failed: status=${createRes3.status}`);
    }

    // ----------------------------------------------------
    // Test 6: Admin GET all ranks (includes inactive)
    // ----------------------------------------------------
    console.log('\n--- Test 6: GET /api/admin/unani/ranks ---');
    const adminListRes = await apiRequest('GET', '/api/admin/unani/ranks', null, adminToken);
    if (adminListRes.status === 200 && adminListRes.data.success && Array.isArray(adminListRes.data.data)) {
      const foundIds = adminListRes.data.data.map((r) => r.id);
      if (foundIds.includes(testRankId1) && foundIds.includes(testRankId2) && foundIds.includes(testRankId3Inactive)) {
        console.log(`✅ PASS: Admin list returns all ranks (count=${adminListRes.data.data.length}), including inactive`);
      } else {
        throw new Error('Admin list did not return all created test ranks');
      }
    } else {
      throw new Error(`Admin list failed: status=${adminListRes.status}`);
    }

    // ----------------------------------------------------
    // Test 7: Admin GET single rank by ID
    // ----------------------------------------------------
    console.log(`\n--- Test 7: GET /api/admin/unani/ranks/${testRankId1} ---`);
    const singleRes = await apiRequest('GET', `/api/admin/unani/ranks/${testRankId1}`, null, adminToken);
    if (singleRes.status === 200 && singleRes.data.success && singleRes.data.data.id === testRankId1) {
      console.log('✅ PASS: Single rank retrieved successfully:', singleRes.data.data.name);
    } else {
      throw new Error(`Single rank fetch failed: status=${singleRes.status}`);
    }

    // ----------------------------------------------------
    // Test 8: Admin PUT update rank
    // ----------------------------------------------------
    console.log(`\n--- Test 8: PUT /api/admin/unani/ranks/${testRankId1} ---`);
    const updateRes = await apiRequest(
      'PUT',
      `/api/admin/unani/ranks/${testRankId1}`,
      {
        name: '__TEST__ Dr. Fatima Begum (Updated)',
        score: 385,
        percentage: 96.25,
      },
      adminToken
    );
    if (updateRes.status === 200 && updateRes.data.success && updateRes.data.data.score === 385) {
      console.log('✅ PASS: Rank updated successfully. New name:', updateRes.data.data.name);
    } else {
      throw new Error(`Update rank failed: status=${updateRes.status}`);
    }

    // ----------------------------------------------------
    // Test 9: Admin PATCH update rank status
    // ----------------------------------------------------
    console.log(`\n--- Test 9: PATCH /api/admin/unani/ranks/${testRankId3Inactive}/status ---`);
    const statusRes = await apiRequest('PATCH', `/api/admin/unani/ranks/${testRankId3Inactive}/status`, { isActive: true }, adminToken);
    if (statusRes.status === 200 && statusRes.data.success && statusRes.data.data.isActive === true) {
      console.log('✅ PASS: Rank status activated successfully');
      // Toggle back to false for public test
      await apiRequest('PATCH', `/api/admin/unani/ranks/${testRankId3Inactive}/status`, { isActive: false }, adminToken);
    } else {
      throw new Error(`Status toggle failed: status=${statusRes.status}`);
    }

    // ----------------------------------------------------
    // Test 10: Public GET /api/unani/ranks (NO TOKEN REQUIRED)
    // ----------------------------------------------------
    console.log('\n--- Test 10: GET /api/unani/ranks (Public, NO Auth) ---');
    const publicRes = await apiRequest('GET', '/api/unani/ranks', null, null);
    if (publicRes.status === 200 && publicRes.data.success && Array.isArray(publicRes.data.data)) {
      console.log(`✅ PASS: Public endpoint returned 200 OK (count=${publicRes.data.data.length})`);
      const publicIds = publicRes.data.data.map((r) => r.id);

      // Verify active are included
      if (publicIds.includes(testRankId1) && publicIds.includes(testRankId2)) {
        console.log('✅ PASS: Active rank holders are returned');
      } else {
        throw new Error('Active test ranks missing from public endpoint');
      }

      // Verify inactive is EXCLUDED
      if (!publicIds.includes(testRankId3Inactive)) {
        console.log('✅ PASS: Inactive rank holder is strictly excluded from public list');
      } else {
        throw new Error('Inactive rank holder was incorrectly included in public list');
      }

      // Verify display ordering (displayOrder 1 should be before displayOrder 2)
      const idx1 = publicIds.indexOf(testRankId1);
      const idx2 = publicIds.indexOf(testRankId2);
      if (idx1 !== -1 && idx2 !== -1 && idx1 < idx2) {
        console.log('✅ PASS: Public list correctly ordered by displayOrder ASC');
      } else {
        throw new Error(`displayOrder ordering failed: idx1=${idx1}, idx2=${idx2}`);
      }
    } else {
      throw new Error(`Public ranks fetch failed: status=${publicRes.status}`);
    }

    // ----------------------------------------------------
    // Test 11: Admin DELETE rank
    // ----------------------------------------------------
    console.log(`\n--- Test 11: DELETE /api/admin/unani/ranks/${testRankId3Inactive} ---`);
    const deleteRes = await apiRequest('DELETE', `/api/admin/unani/ranks/${testRankId3Inactive}`, null, adminToken);
    if (deleteRes.status === 200 && deleteRes.data.success) {
      console.log('✅ PASS: Rank deleted successfully');
      const fetchDeleted = await apiRequest('GET', `/api/admin/unani/ranks/${testRankId3Inactive}`, null, adminToken);
      if (fetchDeleted.status === 404) {
        console.log('✅ PASS: Deleted rank returns 404');
      } else {
        throw new Error('Deleted rank still returned non-404');
      }
    } else {
      throw new Error(`Delete rank failed: status=${deleteRes.status}`);
    }

    // ----------------------------------------------------
    // Test 12: Existing Unani Exam APIs unaffected
    // ----------------------------------------------------
    console.log('\n--- Test 12: Verify existing Unani Exam APIs unaffected ---');
    const examHistRes = await apiRequest('GET', '/api/unani-exams/history', null, adminToken);
    if (examHistRes.status === 200 && examHistRes.data.success) {
      console.log('✅ PASS: Admin Unani Exam History API is 100% operational');
    } else {
      throw new Error(`Unani Exam History API failed: status=${examHistRes.status}`);
    }

    console.log('\n====================================================');
    console.log('🎉 ALL 12 UNANI RANK TEST CASES PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } finally {
    // Clean up test data
    await UnaniRank.deleteMany({ name: { $regex: /^__TEST__/i } });
    await User.deleteMany({ email: { $in: ['__test_admin_rank@test.com', '__test_student_rank@test.com'] } });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    console.log('🧹 Cleanup completed and database disconnected cleanly.');
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILURE:', err);
  process.exit(1);
});
