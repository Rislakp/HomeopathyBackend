require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const app = express();
app.use(cors());
app.use(express.json());

// Mount auth routes
app.use('/api/auth', require('../routes/authRoutes'));

// Test endpoints for role middleware
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

app.get('/api/test/admin-only', authMiddleware, requireRole('admin'), (req, res) => {
  res.json({ success: true, message: 'Admin access granted', user: req.user });
});

app.get('/api/test/student-only', authMiddleware, requireRole('student'), (req, res) => {
  res.json({ success: true, message: 'Student access granted', user: req.user });
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
  const adminEmail = `admin_${timestamp}@test.com`;
  const testPassword = 'Password123!';

  const TEST_PORT = 5055;
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\n========================================`);
    console.log(`RUNNING ROLE-BASED AUTH TESTS on port ${TEST_PORT}`);
    console.log(`========================================\n`);

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
      // 1. Register Student
      console.log('\n--- TEST 1: Register Student ---');
      const regStudentRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Test Student User',
          email: studentEmail,
          password: testPassword,
          role: 'student',
        }
      );
      console.log('Response:', regStudentRes);
      assert(regStudentRes.status === 201, 'Student registered with status 201');
      assert(regStudentRes.data.success === true, 'Response success is true');
      assert(regStudentRes.data.role === 'student', 'Role is student');
      assert(regStudentRes.data.user.email === studentEmail, 'User email matches');
      assert(regStudentRes.data.user.password === undefined, 'Password is not exposed');

      // 2. Duplicate Student Register
      console.log('\n--- TEST 2: Duplicate Register (Same Email) ---');
      const dupRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Test Student User',
          email: studentEmail,
          password: testPassword,
          role: 'student',
        }
      );
      console.log('Response:', dupRes);
      assert(dupRes.status === 400, 'Duplicate register rejected with status 400');
      assert(dupRes.data.success === false, 'Duplicate response success is false');
      assert(dupRes.data.message === 'Account already exists', 'Error message is "Account already exists"');

      // 3. Register Admin
      console.log('\n--- TEST 3: Register Admin ---');
      const regAdminRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Test Admin User',
          email: adminEmail,
          password: testPassword,
          role: 'admin',
        }
      );
      console.log('Response:', regAdminRes);
      assert(regAdminRes.status === 201, 'Admin registered with status 201');
      assert(regAdminRes.data.success === true, 'Admin response success is true');
      assert(regAdminRes.data.role === 'admin', 'Role is admin');

      // 4. Student Login (Success)
      console.log('\n--- TEST 4: Student Login (Matching role) ---');
      const loginStudentRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: testPassword,
          role: 'student',
        }
      );
      console.log('Response:', loginStudentRes);
      assert(loginStudentRes.status === 200, 'Student login returned status 200');
      assert(loginStudentRes.data.success === true, 'Login success is true');
      assert(loginStudentRes.data.role === 'student', 'Returned role is student');
      assert(typeof loginStudentRes.data.token === 'string', 'Returned JWT token');
      studentToken = loginStudentRes.data.token;

      // 5. Admin Login (Success)
      console.log('\n--- TEST 5: Admin Login (Matching role) ---');
      const loginAdminRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: adminEmail,
          password: testPassword,
          role: 'admin',
        }
      );
      console.log('Response:', loginAdminRes);
      assert(loginAdminRes.status === 200, 'Admin login returned status 200');
      assert(loginAdminRes.data.success === true, 'Login success is true');
      assert(loginAdminRes.data.role === 'admin', 'Returned role is admin');
      assert(typeof loginAdminRes.data.token === 'string', 'Returned JWT token');
      adminToken = loginAdminRes.data.token;

      // 6. Role Security: Student credentials with role="admin"
      console.log('\n--- TEST 6: Student credentials + selected role="admin" (Should fail) ---');
      const studentAsAdminRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: studentEmail,
          password: testPassword,
          role: 'admin',
        }
      );
      console.log('Response:', studentAsAdminRes);
      assert(studentAsAdminRes.status === 403, 'Role mismatch returns status 403');
      assert(studentAsAdminRes.data.success === false, 'success is false');
      assert(studentAsAdminRes.data.message === 'Invalid role', 'message is "Invalid role"');

      // 7. Role Security: Admin credentials with role="student"
      console.log('\n--- TEST 7: Admin credentials + selected role="student" (Should fail) ---');
      const adminAsStudentRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: adminEmail,
          password: testPassword,
          role: 'student',
        }
      );
      console.log('Response:', adminAsStudentRes);
      assert(adminAsStudentRes.status === 403, 'Role mismatch returns status 403');
      assert(adminAsStudentRes.data.success === false, 'success is false');
      assert(adminAsStudentRes.data.message === 'Invalid role', 'message is "Invalid role"');

      // 8. Wrong Password
      console.log('\n--- TEST 8: Wrong Password ---');
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
          password: 'wrong_password_123',
          role: 'student',
        }
      );
      console.log('Response:', wrongPassRes);
      assert(wrongPassRes.status === 401, 'Wrong password returns status 401');
      assert(wrongPassRes.data.message === 'Invalid email or password', 'message is "Invalid email or password"');

      // 9. Missing Fields
      console.log('\n--- TEST 9: Missing Fields ---');
      const missingRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: '',
          password: '',
        }
      );
      console.log('Response:', missingRes);
      assert(missingRes.status === 400, 'Missing fields returns status 400');

      // 10. GET /api/auth/me with Student Token
      console.log('\n--- TEST 10: Authenticated Profile (GET /api/auth/me) ---');
      const meRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${studentToken}`,
        },
      });
      console.log('Response:', meRes);
      assert(meRes.status === 200, 'GET /api/auth/me returns status 200');
      assert(meRes.data.user.email === studentEmail, 'Profile email matches');

      // 11. Role Middleware: Student token accessing Admin-Only route
      console.log('\n--- TEST 11: Student token accessing Admin-Only route ---');
      const adminOnlyWithStudentToken = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/test/admin-only',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${studentToken}`,
        },
      });
      console.log('Response:', adminOnlyWithStudentToken);
      assert(adminOnlyWithStudentToken.status === 403, 'Student rejected from admin route with status 403');
      assert(adminOnlyWithStudentToken.data.message === 'Access denied', 'message is "Access denied"');

      // 12. Role Middleware: Admin token accessing Admin-Only route
      console.log('\n--- TEST 12: Admin token accessing Admin-Only route ---');
      const adminOnlyWithAdminToken = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/test/admin-only',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      console.log('Response:', adminOnlyWithAdminToken);
      assert(adminOnlyWithAdminToken.status === 200, 'Admin successfully accesses admin route with status 200');

      // Cleanup test users
      await User.deleteMany({ email: { $in: [studentEmail, adminEmail] } });
      console.log('\nCleaned up test users from database.');

      console.log(`\n========================================`);
      console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
      console.log(`========================================\n`);
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
