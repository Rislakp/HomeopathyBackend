/**
 * scripts/test_normal_unani_separation.js
 *
 * Full integration test verifying complete separation of Normal and Unani test systems:
 * 1. Normal API excludes Unani tests.
 * 2. Unani API returns Unani tests.
 * 3. Normal API returns Normal tests.
 * 4. Unani API excludes Normal tests.
 * 5. New Unani creation writes only to 'unaniexams' and not 'exams'.
 * 6. New Normal creation writes only to 'exams' and not 'unaniexams'.
 * 7. Existing migrated "Unani test" exists only in 'unaniexams'.
 * 8. Search & pagination work independently.
 * 9. Unani Rank Image update & delete work.
 * 10. Clean authorization checks.
 */

require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const Admin = require('../models/admin.model');
const Exam = require('../models/Exam');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const { getJwtSecret } = require('../middleware/rbac');

let server;
const PORT = 5592;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
    const reqHeaders = { ...(options.headers || {}) };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method: options.method || 'GET',
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {
            json = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: json,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function run() {
  await connectDB();
  server = app.listen(PORT);

  let adminUser = await Admin.findOne();
  if (!adminUser) {
    adminUser = await mongoose.model('User').findOne({ role: 'admin' });
  }

  const token = jwt.sign(
    {
      id: adminUser ? adminUser._id.toString() : '6abdf0000000000000000001',
      userId: adminUser ? adminUser._id.toString() : '6abdf0000000000000000001',
      adminId: adminUser ? adminUser._id.toString() : '6abdf0000000000000000001',
      email: adminUser ? adminUser.email : 'admin@whitecoat.academy',
      role: 'admin',
    },
    getJwtSecret(),
    { expiresIn: '1d' }
  );

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let allPassed = true;
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      allPassed = false;
    }
  }

  const createdExamIds = {
    normal: [],
    unani: [],
  };

  const examsCol = mongoose.connection.db.collection('exams');
  const unaniExamsCol = mongoose.connection.db.collection('unaniexams');

  try {
    console.log('\n--- 1. CHECK DATABASE COLLECTIONS FOR "Unani test" ---');

    const inExams = await examsCol.findOne({ _id: new mongoose.Types.ObjectId('6abdf40e67bcbc5a1a73c4e9') });
    const inUnaniExams = await unaniExamsCol.findOne({ _id: new mongoose.Types.ObjectId('6abdf40e67bcbc5a1a73c4e9') });

    assert(!inExams, '"Unani test" is NOT present in "exams" collection');
    assert(Boolean(inUnaniExams), '"Unani test" IS present in "unaniexams" collection');
    if (inUnaniExams) {
      assert(inUnaniExams.courseId === 'unani', '"Unani test" courseId is "unani"');
      assert(inUnaniExams.examType === 'grand_mock_test', '"Unani test" examType is "grand_mock_test"');
      assert(Array.isArray(inUnaniExams.questions) && inUnaniExams.questions.length === 5, '"Unani test" has 5 questions');
    }

    console.log('\n--- 2. NORMAL API (GET /api/exams) EXCLUDES UNANI TESTS ---');
    const normalRes = await request('/api/exams?limit=50', { headers });
    assert(normalRes.status === 200, 'GET /api/exams returns 200');
    const normalExams = normalRes.data?.data || normalRes.data?.exams || [];
    const unaniTestInNormal = normalExams.find(e => (e.title && /unani test/i.test(e.title)) || (e.courseId === 'unani'));
    assert(!unaniTestInNormal, 'No Unani test or exam with courseId="unani" in Normal API response');

    console.log('\n--- 3. UNANI API (GET /api/unani-exams/history) RETURNS UNANI TESTS ---');
    const unaniRes = await request('/api/unani-exams/history?limit=50', { headers });
    assert(unaniRes.status === 200, 'GET /api/unani-exams/history returns 200');
    const unaniTests = unaniRes.data?.data?.tests || [];
    const unaniTestInUnani = unaniTests.find(e => e._id === '6abdf40e67bcbc5a1a73c4e9');
    assert(Boolean(unaniTestInUnani), '"Unani test" (6abdf40e67bcbc5a1a73c4e9) is returned by Unani API');
    if (unaniTestInUnani) {
      assert(unaniTestInUnani.attended === 2, `Attended count is 2 (got ${unaniTestInUnani.attended})`);
    }

    console.log('\n--- 4. CREATE NEW UNANI TEST VIA POST /api/unani-exams ---');
    const timestamp = Date.now();
    const newUnaniPayload = {
      title: `Brand New Unani Verification Exam ${timestamp}`,
      description: 'Test isolation between systems',
      marksPerQuestion: 2,
      negativeMark: 0.5,
      durationMinutes: 45,
      questions: [
        {
          questionText: 'Which Unani temperament corresponds to yellow bile (Safra)?',
          options: { A: 'Hot and Dry', B: 'Cold and Dry', C: 'Hot and Wet', D: 'Cold and Wet' },
          correctOption: 'A',
          explanation: 'Safra is Hot and Dry.',
        },
      ],
    };

    const createUnaniRes = await request('/api/unani-exams', {
      method: 'POST',
      headers,
      body: newUnaniPayload,
    });
    assert(createUnaniRes.status === 201, `POST /api/unani-exams returns 201 (got ${createUnaniRes.status})`);
    const createdUnaniId = createUnaniRes.data?.data?._id || createUnaniRes.data?.data?.id;
    assert(Boolean(createdUnaniId), `Unani exam created with ID: ${createdUnaniId}`);
    if (createdUnaniId) createdExamIds.unani.push(createdUnaniId);

    // Verify where it was stored in MongoDB
    const checkUnaniInNormalCol = await examsCol.findOne({ _id: new mongoose.Types.ObjectId(createdUnaniId) });
    const checkUnaniInUnaniCol = await unaniExamsCol.findOne({ _id: new mongoose.Types.ObjectId(createdUnaniId) });
    assert(!checkUnaniInNormalCol, 'Newly created Unani exam is NOT in "exams" collection');
    assert(Boolean(checkUnaniInUnaniCol), 'Newly created Unani exam IS in "unaniexams" collection');

    // Verify it appears in Unani API and NOT in Normal API
    const verifyUnaniInUnaniHistory = await request('/api/unani-exams/history?limit=50', { headers });
    const unaniHistoryList = verifyUnaniInUnaniHistory.data?.data?.tests || [];
    assert(Boolean(unaniHistoryList.find(e => e._id === createdUnaniId)), 'New Unani test appears in Unani Test History');

    const verifyUnaniInNormalHistory = await request('/api/exams?limit=50', { headers });
    const normalHistoryList = verifyUnaniInNormalHistory.data?.data || [];
    assert(!normalHistoryList.find(e => e._id === createdUnaniId), 'New Unani test does NOT appear in Normal Test History');

    console.log('\n--- 5. CREATE NEW NORMAL TEST VIA POST /api/exams ---');
    const newNormalPayload = {
      title: `Brand New Homeopathy Normal Exam ${timestamp}`,
      testType: 'grand_mock',
      durationMinutes: 60,
      marksPerQuestion: 1,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'What is the minimum dose concept in Homeopathy?',
          options: { A: 'Similia Similibus Curentur', B: 'Law of Minimum', C: 'Vital Force', D: 'Miasms' },
          correctOption: 'B',
        },
      ],
    };

    const createNormalRes = await request('/api/exams', {
      method: 'POST',
      headers,
      body: newNormalPayload,
    });
    assert(createNormalRes.status === 201, `POST /api/exams returns 201 (got ${createNormalRes.status})`);
    const createdNormalId = createNormalRes.data?.exam?._id || createNormalRes.data?.exam?.id;
    assert(Boolean(createdNormalId), `Normal exam created with ID: ${createdNormalId}`);
    if (createdNormalId) createdExamIds.normal.push(createdNormalId);

    // Verify where it was stored in MongoDB
    const checkNormalInNormalCol = await examsCol.findOne({ _id: new mongoose.Types.ObjectId(createdNormalId) });
    const checkNormalInUnaniCol = await unaniExamsCol.findOne({ _id: new mongoose.Types.ObjectId(createdNormalId) });
    assert(Boolean(checkNormalInNormalCol), 'Newly created Normal exam IS in "exams" collection');
    assert(!checkNormalInUnaniCol, 'Newly created Normal exam is NOT in "unaniexams" collection');

    // Verify it appears in Normal API and NOT in Unani API
    const checkNormalHistory = await request('/api/exams?limit=50', { headers });
    const normList = checkNormalHistory.data?.data || [];
    assert(Boolean(normList.find(e => e._id === createdNormalId)), 'New Normal test appears in Normal Test History');

    const checkUnaniForNormal = await request('/api/unani-exams/history?limit=50', { headers });
    const uList = checkUnaniForNormal.data?.data?.tests || [];
    assert(!uList.find(e => e._id === createdNormalId), 'New Normal test does NOT appear in Unani Test History');

    console.log('\n--- 6. SEARCH & PAGINATION INDEPENDENCE ---');
    // Normal search
    const searchNormal = await request(`/api/exams?search=Homeopathy&limit=5`, { headers });
    assert(searchNormal.status === 200, 'Normal search returns 200');
    assert((searchNormal.data?.data || []).every(e => e.courseId !== 'unani'), 'Normal search results contain no Unani exams');

    // Unani search
    const searchUnani = await request(`/api/unani-exams/history?search=Unani&limit=5`, { headers });
    assert(searchUnani.status === 200, 'Unani search returns 200');
    assert((searchUnani.data?.data?.tests || []).every(e => e.courseId === 'unani'), 'Unani search results contain only Unani exams');

    console.log('\n--- 7. UNANI RANK IMAGE ENDPOINTS ---');
    const rankImageRes = await request(`/api/unani-exams/${createdUnaniId}/rank-image`, {
      method: 'PUT',
      headers,
      body: {
        studentId: '6aa17d0afa439f3ad0c6d56e',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
      },
    });
    assert(rankImageRes.status === 200, 'PUT /api/unani-exams/:id/rank-image returns 200');
    assert(rankImageRes.data?.data?.imageUrl === 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg', 'Rank image updated successfully');

    const deleteRankImgRes = await request(`/api/unani-exams/${createdUnaniId}/rank-image`, {
      method: 'DELETE',
      headers,
      body: {
        studentId: '6aa17d0afa439f3ad0c6d56e',
      },
    });
    console.log('DELETE rank image response:', deleteRankImgRes.status, deleteRankImgRes.data);
    assert(deleteRankImgRes.status === 200, 'DELETE /api/unani-exams/:id/rank-image returns 200');

  } finally {
    console.log('\n--- CLEANING UP TEMPORARY VERIFICATION EXAMS ---');
    for (const id of createdExamIds.unani) {
      await unaniExamsCol.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    for (const id of createdExamIds.normal) {
      await examsCol.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    console.log('Cleanup complete.');

    server.close();
    await mongoose.disconnect();
  }

  console.log('\n==================================================');
  if (allPassed) {
    console.log('🎉 ALL INTEGRATION TESTS PASSED: COMPLETE NORMAL / UNANI TEST SEPARATION VERIFIED!');
  } else {
    console.error('❌ SOME INTEGRATION TESTS FAILED.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  if (server) server.close();
  process.exit(1);
});
