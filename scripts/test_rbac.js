require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');

const app = express();
app.use(cors());
app.use(express.json());

// Mount application routes
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/v1/admin', require('../routes/adminRoutes'));
app.use('/api/courses', require('../routes/courseRoutes'));
app.use(require('../src/student/student.routes'));
app.use(require('../routes/exam.routes'));

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', (e) => reject(e));

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runRBACTests() {
  console.log('Connecting to database for RBAC test suite...');
  await connectDB();

  const timestamp = Date.now();
  const studentEmail = `student_rbac_${timestamp}@test.com`;
  const studentPhone = `88888${timestamp.toString().slice(-5)}`;
  const studentPassword = 'StudentSecret123!';

  const adminEmail = `admin_rbac_${timestamp}@test.com`;
  const adminPhone = `77777${timestamp.toString().slice(-5)}`;
  const adminPassword = 'AdminSecret123!';

  const TEST_PORT = 5099;
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`RUNNING FULL ROLE-BASED ACCESS CONTROL (RBAC) TEST SUITE`);
    console.log(`======================================================\n`);

    let studentToken = null;
    let studentId = null;
    let adminToken = null;
    let adminId = null;
    let passed = 0;
    let failed = 0;

    function assert(condition, message, details) {
      if (condition) {
        console.log(`✅ PASS: ${message}`);
        passed++;
      } else {
        console.error(`❌ FAIL: ${message}`, details || '');
        failed++;
      }
    }

    try {
      // ---------------------------------------------------------
      // SETUP: Create Student and Admin in DB
      // ---------------------------------------------------------
      console.log('--- SETUP: Registering Test Student & Admin ---');
      const regRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'RBAC Test Student',
          email: studentEmail,
          password: studentPassword,
          contactNumber: studentPhone,
          qualification: 'BHMS',
          dateOfBirth: '2000-01-01',
        }
      );
      assert(
        regRes.status === 201 && regRes.data?.role === 'student',
        'Student registration sets role="student" and returns 201',
        regRes.data
      );
      studentToken = regRes.data?.token;
      studentId = regRes.data?.user?.id;

      // Create Admin user directly in MongoDB
      const adminUser = await User.create({
        name: 'RBAC Test Admin',
        email: adminEmail,
        password: adminPassword,
        contactNumber: adminPhone,
        phone: adminPhone,
        qualification: 'MD (Hom)',
        dateOfBirth: '1985-05-15',
        role: 'admin',
      });
      adminId = adminUser._id.toString();
      assert(adminUser && adminUser.role === 'admin', 'Admin user created with role="admin"');

      // ---------------------------------------------------------
      // TEST 1: Admin Login
      // ---------------------------------------------------------
      console.log('\n--- TEST 1: Admin Login & Authorization ---');
      const adminLoginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/admin/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: adminEmail,
          password: adminPassword,
        }
      );
      assert(
        adminLoginRes.status === 200 && adminLoginRes.data?.role === 'admin',
        'Admin login succeeds with role="admin"',
        adminLoginRes.data
      );
      adminToken = adminLoginRes.data?.token;

      // Admin accesses Admin API (GET /api/v1/admin/students)
      const adminApiRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/admin/students',
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert(
        adminApiRes.status === 200,
        'Admin can access Admin API (/api/v1/admin/students)',
        adminApiRes.data
      );

      // Student tries to use Admin login endpoint
      const studentOnAdminLoginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/admin/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: studentPassword,
        }
      );
      assert(
        studentOnAdminLoginRes.status === 403,
        'Student attempting Admin Login endpoint is rejected with 403 Forbidden',
        studentOnAdminLoginRes.data
      );

      // ---------------------------------------------------------
      // TEST 2: Student Login
      // ---------------------------------------------------------
      console.log('\n--- TEST 2: Student Login & Authorization ---');
      const studentLoginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/student/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: studentPassword,
        }
      );
      assert(
        studentLoginRes.status === 200 && studentLoginRes.data?.role === 'student',
        'Student login succeeds with role="student"',
        studentLoginRes.data
      );

      // Student accesses Student API (GET /api/student/exams)
      const studentApiRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/student/exams',
        method: 'GET',
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert(
        studentApiRes.status === 200,
        'Student can access Student API (/api/student/exams)',
        studentApiRes.data
      );

      // Admin tries to use Student login endpoint
      const adminOnStudentLoginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/student/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: adminEmail,
          password: adminPassword,
        }
      );
      assert(
        adminOnStudentLoginRes.status === 403,
        'Admin attempting Student Login endpoint is rejected with 403 Forbidden',
        adminOnStudentLoginRes.data
      );

      // ---------------------------------------------------------
      // TEST 3: Student Attempts Admin API
      // ---------------------------------------------------------
      console.log('\n--- TEST 3: Student Attempts Admin API (403 Expected) ---');
      const studentTriesAdminRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/admin/students',
        method: 'GET',
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert(
        studentTriesAdminRes.status === 403,
        'Student accessing Admin API returns 403 Forbidden',
        studentTriesAdminRes.data
      );

      // Student tries to create a course (POST /api/courses)
      const studentTriesCreateCourseRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/courses',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
          },
        },
        {
          title: 'Unauthorized Course',
          instructor: 'Student Imposter',
          category: 'Materia Medica',
          price: 999,
        }
      );
      assert(
        studentTriesCreateCourseRes.status === 403,
        'Student attempting course creation returns 403 Forbidden',
        studentTriesCreateCourseRes.data
      );

      // ---------------------------------------------------------
      // TEST 4: Unauthenticated User Attempts Protected APIs
      // ---------------------------------------------------------
      console.log('\n--- TEST 4: Unauthenticated Requests (401 Expected) ---');
      const noAuthAdminRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/admin/students',
        method: 'GET',
      });
      assert(
        noAuthAdminRes.status === 401,
        'Unauthenticated request to Admin API returns 401 Unauthorized',
        noAuthAdminRes.data
      );

      const noAuthStudentRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/student/exams',
        method: 'GET',
      });
      assert(
        noAuthStudentRes.status === 401,
        'Unauthenticated request to Student API returns 401 Unauthorized',
        noAuthStudentRes.data
      );

      // ---------------------------------------------------------
      // TEST 5: Universal Login Endpoint
      // ---------------------------------------------------------
      console.log('\n--- TEST 5: Universal Login Endpoint (/api/auth/login) ---');
      const uniAdminLogin = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        { email: adminEmail, password: adminPassword }
      );
      assert(
        uniAdminLogin.status === 200 && uniAdminLogin.data?.role === 'admin',
        'Universal login correctly identifies admin and returns role="admin"',
        uniAdminLogin.data
      );

      const uniStudentLogin = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        { email: studentEmail, password: studentPassword }
      );
      assert(
        uniStudentLogin.status === 200 && uniStudentLogin.data?.role === 'student',
        'Universal login correctly identifies student and returns role="student"',
        uniStudentLogin.data
      );

      // ---------------------------------------------------------
      // TEST 6: Admin Role Management
      // ---------------------------------------------------------
      console.log('\n--- TEST 6: Admin Role Management Endpoint ---');
      // Student tries to change another user's role (Forbidden)
      const studentChangesRoleRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: `/api/v1/admin/users/${studentId}/role`,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
          },
        },
        { role: 'admin' }
      );
      assert(
        studentChangesRoleRes.status === 403,
        'Student cannot modify user role (403 Forbidden)',
        studentChangesRoleRes.data
      );

      // Admin changes user role to teacher/admin
      const adminChangesRoleRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: `/api/v1/admin/users/${studentId}/role`,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { role: 'admin' }
      );
      assert(
        adminChangesRoleRes.status === 200 &&
          adminChangesRoleRes.data?.user?.role === 'admin',
        'Admin can update student role to "admin"',
        adminChangesRoleRes.data
      );

      // Verify database updated
      const updatedUser = await User.findById(studentId);
      assert(
        updatedUser.role === 'admin',
        'Database reflects updated role for user'
      );

      // Revert user back to student
      await User.updateOne({ _id: studentId }, { $set: { role: 'student' } });

      // ---------------------------------------------------------
      // TEST 7: Invalid Token / Logout Invalidation
      // ---------------------------------------------------------
      console.log('\n--- TEST 7: Invalid Token Handling ---');
      const invalidTokenRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/admin/students',
        method: 'GET',
        headers: { Authorization: 'Bearer invalid_bogus_token_12345' },
      });
      assert(
        invalidTokenRes.status === 401,
        'Request with invalid Bearer token returns 401 Unauthorized',
        invalidTokenRes.data
      );

    } catch (err) {
      console.error('Fatal test error:', err);
      failed++;
    } finally {
      // Clean up test users
      await User.deleteOne({ email: studentEmail });
      await User.deleteOne({ email: adminEmail });
      await Student.deleteOne({ email: studentEmail });

      server.close(() => {
        console.log(`\n======================================================`);
        console.log(`RBAC TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
        console.log(`======================================================\n`);
        process.exit(failed > 0 ? 1 : 0);
      });
    }
  });
}

runRBACTests();
