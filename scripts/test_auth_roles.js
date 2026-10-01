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

// Mount auth routes
app.use('/api/auth', require('../routes/authRoutes'));

const authMiddleware = require('../middleware/authMiddleware');

app.get('/api/test/protected', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Protected access granted', user: req.user });
});

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

async function runTests() {
  console.log('Connecting to database for test...');
  await connectDB();

  const timestamp = Date.now();
  const studentEmail = `student_${timestamp}@test.com`;
  const studentPhone = `98765${timestamp.toString().slice(-5)}`;
  const studentPassword = 'StudentPass123!';

  const adminEmail = `admin_${timestamp}@test.com`;
  const adminPassword = 'AdminPass123!';

  const TEST_PORT = 5088;
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`RUNNING AUTHENTICATION & ROLE-BASED ACCESS CONTROL TESTS`);
    console.log(`======================================================\n`);

    let studentToken = null;
    let adminToken = null;
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
      if (condition) {
        console.log(`✅ PASS: ${message}`);
        passed++;
      } else {
        console.error(`❌ FAIL: ${message}`);
        failed++;
      }
    }

    try {
      // ---------------------------------------------------------
      // 1. Missing Field Validation Check
      // ---------------------------------------------------------
      console.log('\n--- TEST 1: Registration Missing Required Field ---');
      const missingFieldRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Incomplete Student',
          email: `inc_${timestamp}@test.com`,
          password: studentPassword,
          // Missing qualification, dateOfBirth, contactNumber
        }
      );
      console.log('Response:', missingFieldRes.data);
      assert(missingFieldRes.status === 400, 'Returns 400 Bad Request on missing fields');
      assert(missingFieldRes.data.success === false, 'success is false');
      assert(Array.isArray(missingFieldRes.data.errors), 'Returns errors array');

      // ---------------------------------------------------------
      // 2. Student Registration (POST /api/auth/register)
      // ---------------------------------------------------------
      console.log('\n--- TEST 2: Valid Student Registration ---');
      const regRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Jane Doe',
          email: studentEmail,
          password: studentPassword,
          dateOfBirth: '15/08/1998',
          contactNumber: studentPhone,
          qualification: 'BHMS',
        }
      );
      console.log('Response:', regRes.data);
      assert(regRes.status === 201, 'Returns 201 Created on registration');
      assert(regRes.data.success === true, 'success is true');
      assert(regRes.data.role === 'student', 'role is "student"');
      assert(typeof regRes.data.token === 'string', 'JWT token returned');
      assert(regRes.data.user.email === studentEmail, 'User email matches');
      assert(regRes.data.user.phone === studentPhone, 'User phone matches');
      assert(regRes.data.user.qualification === 'BHMS', 'Qualification matches');
      assert(regRes.data.user.dateOfBirth === '15/08/1998', 'Date of birth matches');

      // ---------------------------------------------------------
      // 3. Duplicate Email / Phone Check
      // ---------------------------------------------------------
      console.log('\n--- TEST 3: Duplicate Email Check ---');
      const dupEmailRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Duplicate Student',
          email: studentEmail,
          password: studentPassword,
          dateOfBirth: '01/01/2000',
          contactNumber: '1112223334',
          qualification: 'MBBS',
        }
      );
      console.log('Response:', dupEmailRes.data);
      assert(dupEmailRes.status === 400, 'Duplicate email returns 400 Bad Request');
      assert(dupEmailRes.data.success === false, 'success is false');

      console.log('\n--- TEST 4: Duplicate Phone Check ---');
      const dupPhoneRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Duplicate Student Phone',
          email: `new_${timestamp}@test.com`,
          password: studentPassword,
          dateOfBirth: '01/01/2000',
          contactNumber: studentPhone,
          qualification: 'MBBS',
        }
      );
      console.log('Response:', dupPhoneRes.data);
      assert(dupPhoneRes.status === 400, 'Duplicate phone returns 400 Bad Request');
      assert(dupPhoneRes.data.success === false, 'success is false');

      // ---------------------------------------------------------
      // 4. Student Login Success
      // ---------------------------------------------------------
      console.log('\n--- TEST 5: Student Login (POST /api/auth/login) ---');
      const studentLoginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: studentPassword,
        }
      );
      console.log('Response:', studentLoginRes.data);
      assert(studentLoginRes.status === 200, 'Student login returns 200 OK');
      assert(studentLoginRes.data.success === true, 'success is true');
      assert(studentLoginRes.data.role === 'student', 'role is "student"');
      assert(typeof studentLoginRes.data.token === 'string', 'JWT token returned');
      assert(studentLoginRes.data.user.email === studentEmail, 'Profile email matches');
      studentToken = studentLoginRes.data.token;

      // ---------------------------------------------------------
      // 5. Create Admin Account Directly in DB
      // ---------------------------------------------------------
      console.log('\n--- Creating Admin user in DB ---');
      const adminUser = await User.create({
        name: 'Admin User',
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
      });
      console.log('Admin created:', adminUser.email);

      // ---------------------------------------------------------
      // 6. Admin User Attempting Student Login (Should fail with 403)
      // ---------------------------------------------------------
      console.log('\n--- TEST 6: Admin Account Attempting Student Login ---');
      const adminInStudentLoginRes = await makeRequest(
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
      console.log('Response:', adminInStudentLoginRes.data);
      assert(adminInStudentLoginRes.status === 403, 'Admin logging into student endpoint returns 403 Forbidden');
      assert(adminInStudentLoginRes.data.success === false, 'success is false');
      assert(adminInStudentLoginRes.data.message.includes('Student access only'), 'Contains "Student access only" message');

      // ---------------------------------------------------------
      // 7. Admin Login Success (POST /api/auth/admin/login)
      // ---------------------------------------------------------
      console.log('\n--- TEST 7: Admin Login (POST /api/auth/admin/login) ---');
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
      console.log('Response:', adminLoginRes.data);
      assert(adminLoginRes.status === 200, 'Admin login returns 200 OK');
      assert(adminLoginRes.data.success === true, 'success is true');
      assert(adminLoginRes.data.role === 'admin', 'role is "admin"');
      assert(typeof adminLoginRes.data.token === 'string', 'JWT token returned');
      adminToken = adminLoginRes.data.token;

      // ---------------------------------------------------------
      // 8. Student Account Attempting Admin Login (Should fail with 403)
      // ---------------------------------------------------------
      console.log('\n--- TEST 8: Student Account Attempting Admin Login ---');
      const studentInAdminLoginRes = await makeRequest(
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
      console.log('Response:', studentInAdminLoginRes.data);
      assert(studentInAdminLoginRes.status === 403, 'Student logging into admin endpoint returns 403 Forbidden');
      assert(studentInAdminLoginRes.data.success === false, 'success is false');
      assert(studentInAdminLoginRes.data.message.includes('Admin privileges required'), 'Contains "Admin privileges required" message');

      // ---------------------------------------------------------
      // 9. Invalid Credentials Check (Wrong Password)
      // ---------------------------------------------------------
      console.log('\n--- TEST 9: Invalid Credentials (Wrong Password) ---');
      const wrongPassRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: 'WrongPassword123!',
        }
      );
      console.log('Response:', wrongPassRes.data);
      assert(wrongPassRes.status === 401, 'Wrong password returns 401 Unauthorized');
      assert(wrongPassRes.data.success === false, 'success is false');

      // ---------------------------------------------------------
      // 10. Profile Endpoint (GET /api/auth/me)
      // ---------------------------------------------------------
      console.log('\n--- TEST 10: Profile Endpoint (GET /api/auth/me) ---');
      const profileRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${studentToken}`,
        },
      });
      console.log('Response:', profileRes.data);
      assert(profileRes.status === 200, 'GET /api/auth/me returns status 200');
      assert(profileRes.data.user.email === studentEmail, 'Profile email matches');
      assert(profileRes.data.user.role === 'student', 'Profile role is student');

      // Clean up test data
      await User.deleteMany({ email: { $in: [studentEmail, adminEmail, `inc_${timestamp}@test.com`, `new_${timestamp}@test.com`] } });
      await Student.deleteMany({ email: { $in: [studentEmail, adminEmail, `inc_${timestamp}@test.com`, `new_${timestamp}@test.com`] } });
      console.log('\nCleaned up test accounts from database.');

      console.log(`\n======================================================`);
      console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
      console.log(`======================================================\n`);
    } catch (err) {
      console.error('Test execution error:', err);
    } finally {
      server.close();
      await mongoose.connection.close();
      process.exit(failed > 0 ? 1 : 0);
    }
  });
}

runTests();
