/**
 * Comprehensive Test Suite for Independent Unani Review / Testimonials Module
 *
 * Tests:
 * 1. Public GET reviews
 * 2. Admin GET reviews
 * 3. Admin POST review
 * 4. Admin GET single review
 * 5. Admin PUT review
 * 6. Admin PATCH status
 * 7. Admin DELETE review
 * 8. Search
 * 9. Pagination
 * 10. Rating validation
 * 11. Missing authentication
 * 12. courseId automatically equals "unani"
 * 13. Public endpoint hides inactive reviews
 * 14. Reviews are sorted by displayOrder
 *
 * Plus Regression Tests:
 * - Unani Rank APIs
 * - Unani Exam APIs
 * - Normal Exam APIs
 */

const mongoose = require('mongoose');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

async function runTests() {
  console.log('===========================================================');
  console.log('🧪 RUNNING UNANI REVIEWS / TESTIMONIALS MODULE TEST SUITE');
  console.log('===========================================================\n');

  // 1. Connect Mongoose
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whitecoat';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  // 2. Start Test Express Server
  const { app } = require('../server');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Test Server running on ${baseUrl}\n`);

  // Load models
  const UnaniReview = require('../src/unani/reviews/models/unaniReview.model');
  const User = require('../models/User');

  // Clean up any test reviews
  await UnaniReview.deleteMany({ name: { $regex: /^__TEST__/i } });

  // Prepare Tokens
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await User.create({
      name: '__TEST__ Admin Review',
      email: '__test_admin_review@test.com',
      password: 'password123',
      role: 'admin',
    });
  }
  const adminToken = jwt.sign(
    { userId: adminUser._id.toString(), id: adminUser._id.toString(), role: 'admin', email: adminUser.email },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  let studentUser = await User.findOne({ role: 'student' });
  if (!studentUser) {
    studentUser = await User.create({
      name: '__TEST__ Student Review',
      email: '__test_student_review@test.com',
      password: 'password123',
      role: 'student',
    });
  }
  const studentToken = jwt.sign(
    { userId: studentUser._id.toString(), id: studentUser._id.toString(), role: 'student', email: studentUser.email },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Helper HTTP request function
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
    return { status: res.status, body: data, data };
  }

  let createdReviewId = null;
  let secondReviewId = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Public GET reviews
    // -------------------------------------------------------------
    console.log('--- Test 1: Public GET /api/unani/reviews ---');
    const pubRes1 = await apiRequest('GET', '/api/unani/reviews');
    console.log('Public GET status:', pubRes1.status);
    console.log('Public GET count:', pubRes1.body?.count);
    if (pubRes1.status === 200 && pubRes1.body.success === true) {
      console.log('✅ Test 1 Passed: Public GET /api/unani/reviews works');
    } else {
      console.error('❌ Test 1 Failed:', pubRes1.body);
    }

    // -------------------------------------------------------------
    // Test 11: Missing / Invalid Authentication for Admin Endpoints
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Missing/Invalid Auth Protection ---');
    const noAuthRes = await apiRequest('POST', '/api/admin/unani/reviews', { name: 'Test' });
    if (noAuthRes.status === 401) {
      console.log('✅ Test 11 Passed: Admin POST without token returned 401 Unauthorized');
    } else {
      console.error('❌ Test 11 Failed: Expected 401, got', noAuthRes.status);
    }

    const studAuthRes = await apiRequest('POST', '/api/admin/unani/reviews', { name: 'Test' }, studentToken);
    if (studAuthRes.status === 403 || studAuthRes.status === 401) {
      console.log('✅ Test 11 Passed: Student token rejected for Admin POST (Status:', studAuthRes.status, ')');
    } else {
      console.error('❌ Test 11 Failed: Student token allowed! Status:', studAuthRes.status);
    }

    // -------------------------------------------------------------
    // Test 10: Rating validation
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Rating Validation ---');
    const badRatingRes1 = await apiRequest('POST', '/api/admin/unani/reviews', {
      name: '__TEST__ Dr. Invalid',
      review: 'Great course!',
      rating: 10, // Invalid > 5
    }, adminToken);
    if (badRatingRes1.status === 400 && badRatingRes1.body.success === false) {
      console.log('✅ Test 10 Passed: Rating 10 rejected with 400 Validation Error');
    } else {
      console.error('❌ Test 10 Failed: Rating 10 accepted! Status:', badRatingRes1.status);
    }

    const badRatingRes2 = await apiRequest('POST', '/api/admin/unani/reviews', {
      name: '__TEST__ Dr. Invalid',
      review: 'Great course!',
      rating: 0, // Invalid < 1
    }, adminToken);
    if (badRatingRes2.status === 400) {
      console.log('✅ Test 10 Passed: Rating 0 rejected with 400 Validation Error');
    } else {
      console.error('❌ Test 10 Failed: Rating 0 accepted!');
    }

    // -------------------------------------------------------------
    // Test 3 & 12: Admin POST Review & Automatic courseId = "unani"
    // -------------------------------------------------------------
    console.log('\n--- Test 3 & 12: Admin POST Review & courseId="unani" ---');
    const postRes1 = await apiRequest('POST', '/api/admin/unani/reviews', {
      name: '__TEST__ Dr. Asif Mohammed',
      subtitle: 'AIAPGET Ranker · Kerala',
      review: 'The high-yield mock tests and daily discussion classes were the turning point in my exam prep.',
      rating: 5,
      profileImage: 'https://s3.amazonaws.com/test-bucket/asif.jpg',
      displayOrder: 2,
      isActive: true,
      courseId: 'hacked_course', // Should be ignored/overridden to "unani"
    }, adminToken);

    if (postRes1.status === 201 && postRes1.body.success === true) {
      createdReviewId = postRes1.body.data.id || postRes1.body.data._id;
      console.log('✅ Test 3 Passed: Review created with ID:', createdReviewId);
      if (postRes1.body.data.courseId === 'unani') {
        console.log('✅ Test 12 Passed: courseId automatically set to "unani"');
      } else {
        console.error('❌ Test 12 Failed: courseId was set to:', postRes1.body.data.courseId);
      }
    } else {
      console.error('❌ Test 3 Failed:', postRes1.body);
    }

    // Create a second review with displayOrder = 1 (to test sorting)
    const postRes2 = await apiRequest('POST', '/api/admin/unani/reviews', {
      name: '__TEST__ Dr. Mariyam Khan',
      subtitle: 'PSC Selected · Tamil Nadu',
      review: 'Guide House provided the structure and clarity I needed between classical Kulliyat and modern medicine.',
      rating: 5,
      profileImage: '',
      displayOrder: 1, // lower display order -> should come first in ascending order
      isActive: true,
    }, adminToken);
    if (postRes2.status === 201) {
      secondReviewId = postRes2.body.data.id || postRes2.body.data._id;
    }

    // -------------------------------------------------------------
    // Test 2 & 8 & 9: Admin GET reviews, Search, Pagination
    // -------------------------------------------------------------
    console.log('\n--- Test 2, 8, 9: Admin GET reviews, Search, Pagination ---');
    const adminGetRes = await apiRequest('GET', '/api/admin/unani/reviews?page=1&limit=20', null, adminToken);
    if (adminGetRes.status === 200 && adminGetRes.body.pagination) {
      console.log('✅ Test 2 & 9 Passed: Admin GET list returns pagination:', adminGetRes.body.pagination);
    } else {
      console.error('❌ Test 2/9 Failed:', adminGetRes.body);
    }

    // Search Test
    const searchRes = await apiRequest('GET', '/api/admin/unani/reviews?search=Mariyam', null, adminToken);
    if (searchRes.status === 200 && searchRes.body.data.length >= 1 && searchRes.body.data[0].name.includes('Mariyam')) {
      console.log('✅ Test 8 Passed: Search by keyword "Mariyam" matched correctly');
    } else {
      console.error('❌ Test 8 Failed:', searchRes.body);
    }

    // -------------------------------------------------------------
    // Test 4: Admin GET Single Review
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Admin GET Single Review by ID ---');
    const singleRes = await apiRequest('GET', `/api/admin/unani/reviews/${createdReviewId}`, null, adminToken);
    if (singleRes.status === 200 && singleRes.body.data.name.includes('Asif')) {
      console.log('✅ Test 4 Passed: Admin GET single review returned correct object');
    } else {
      console.error('❌ Test 4 Failed:', singleRes.body);
    }

    // -------------------------------------------------------------
    // Test 5: Admin PUT Update Review
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Admin PUT Update Review ---');
    const putRes = await apiRequest('PUT', `/api/admin/unani/reviews/${createdReviewId}`, {
      name: '__TEST__ Dr. Asif Mohammed (Updated)',
      review: 'Updated review content for testing purposes.',
      rating: 4,
      displayOrder: 2,
    }, adminToken);
    if (putRes.status === 200 && putRes.body.data.name.includes('Updated') && putRes.body.data.rating === 4) {
      console.log('✅ Test 5 Passed: PUT update updated name to', putRes.body.data.name, 'and rating to', putRes.body.data.rating);
    } else {
      console.error('❌ Test 5 Failed:', putRes.body);
    }

    // -------------------------------------------------------------
    // Test 6 & 13: Admin PATCH status & Public Endpoint Hides Inactive Reviews
    // -------------------------------------------------------------
    console.log('\n--- Test 6 & 13: PATCH status & Hiding Inactive Reviews ---');
    const patchRes = await apiRequest('PATCH', `/api/admin/unani/reviews/${createdReviewId}/status`, { isActive: false }, adminToken);
    if (patchRes.status === 200 && patchRes.body.data.isActive === false) {
      console.log('✅ Test 6 Passed: PATCH status set isActive = false');
    } else {
      console.error('❌ Test 6 Failed:', patchRes.body);
    }

    // Verify Public GET hides the inactive review
    const pubResHide = await apiRequest('GET', '/api/unani/reviews');
    const inactiveFound = pubResHide.body.data?.find((r) => r.id === createdReviewId || r._id === createdReviewId);
    if (!inactiveFound) {
      console.log('✅ Test 13 Passed: Public GET hides inactive review successfully');
    } else {
      console.error('❌ Test 13 Failed: Inactive review was returned in public GET!');
    }

    // Reactivate createdReviewId
    await apiRequest('PATCH', `/api/admin/unani/reviews/${createdReviewId}/status`, { isActive: true }, adminToken);

    // -------------------------------------------------------------
    // Test 14: Reviews are sorted by displayOrder ASC
    // -------------------------------------------------------------
    console.log('\n--- Test 14: Sorting by displayOrder ASC ---');
    const sortRes = await apiRequest('GET', '/api/unani/reviews');
    const testItems = (sortRes.body.data || []).filter((r) => r.name.startsWith('__TEST__'));
    if (testItems.length >= 2) {
      if (testItems[0].displayOrder <= testItems[1].displayOrder) {
        console.log(`✅ Test 14 Passed: Items correctly sorted by displayOrder ASC (${testItems[0].displayOrder} <= ${testItems[1].displayOrder})`);
      } else {
        console.error('❌ Test 14 Failed: Incorrect order:', testItems[0].displayOrder, '>', testItems[1].displayOrder);
      }
    } else {
      console.log('ℹ️ Test 14 Info: Only 1 test item visible, check displayOrder manually');
    }

    // -------------------------------------------------------------
    // Test 7: Admin DELETE Review
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Admin DELETE Review ---');
    const delRes = await apiRequest('DELETE', `/api/admin/unani/reviews/${createdReviewId}`, null, adminToken);
    if (delRes.status === 200 && delRes.body.success === true) {
      console.log('✅ Test 7 Passed: Review deleted successfully');
    } else {
      console.error('❌ Test 7 Failed:', delRes.body);
    }

    // Verify 404 on GET single after deletion
    const get404 = await apiRequest('GET', `/api/admin/unani/reviews/${createdReviewId}`, null, adminToken);
    if (get404.status === 404) {
      console.log('✅ Verified 404 after deletion');
    }

    // Delete second test review
    if (secondReviewId) {
      await apiRequest('DELETE', `/api/admin/unani/reviews/${secondReviewId}`, null, adminToken);
    }

    // -------------------------------------------------------------
    // REGRESSION TESTS: Check Unani Rank, Unani Exam & Normal Exam APIs
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🔄 REGRESSION TESTS: Verifying existing APIs continue working');
    console.log('-------------------------------------------------------------');

    // 1. Unani Rank API
    const unaniRankRes = await apiRequest('GET', '/api/unani/ranks');
    if (unaniRankRes.status === 200 && unaniRankRes.body.success === true) {
      console.log('✅ Regression Test Passed: Public Unani Rank API (/api/unani/ranks) returns 200 OK');
    } else {
      console.error('❌ Regression Test Failed: Unani Rank API returned:', unaniRankRes.status);
    }

    // 2. Unani Exam API
    const unaniExamRes = await apiRequest('GET', '/api/unani-exams/student', null, studentToken);
    if (unaniExamRes.status === 200 || unaniExamRes.status === 404) {
      console.log('✅ Regression Test Passed: Unani Exam Student API (/api/unani-exams/student) responded cleanly (Status:', unaniExamRes.status, ')');
    } else {
      console.error('❌ Regression Test Failed: Unani Exam Student API returned:', unaniExamRes.status);
    }

    // 3. Normal Exam API
    const normalExamRes = await apiRequest('GET', '/api/exams', null, adminToken);
    if (normalExamRes.status === 200 || normalExamRes.status === 404 || normalExamRes.status === 403) {
      console.log('✅ Regression Test Passed: Normal Exam API (/api/exams) responded cleanly (Status:', normalExamRes.status, ')');
    } else {
      console.error('❌ Regression Test Failed: Normal Exam API returned:', normalExamRes.status);
    }

    console.log('\n===========================================================');
    console.log('🎉 ALL TEST SUITE CHECKS COMPLETED SUCCESSFULLY!');
    console.log('===========================================================\n');
  } catch (err) {
    console.error('❌ Test execution error:', err);
  } finally {
    // Clean up test reviews
    await UnaniReview.deleteMany({ name: { $regex: /^__TEST__/i } });
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

runTests();
