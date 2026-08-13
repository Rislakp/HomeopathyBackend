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
  const testEmail = `user_${timestamp}@test.com`;
  const testPassword = 'Password123!';

  const TEST_PORT = 5055;
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\n========================================`);
    console.log(`RUNNING ROLE-FREE AUTH TESTS on port ${TEST_PORT}`);
    console.log(`========================================\n`);

    let userToken = null;
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
      // 1. Signup / Register User
      console.log('\n--- TEST 1: User Signup ---');
      const regRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/signup',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Test User',
          email: testEmail,
          password: testPassword,
        }
      );
      console.log('Response:', regRes);
      assert(regRes.status === 201, 'User registered with status 201');
      assert(regRes.data.success === true, 'Response success is true');
      assert(regRes.data.role === undefined, 'No role in response root');
      assert(regRes.data.user.role === undefined, 'No role in response user object');
      assert(regRes.data.user.email === testEmail, 'User email matches');
      assert(typeof regRes.data.token === 'string', 'Token returned on signup');

      // 2. Duplicate Signup
      console.log('\n--- TEST 2: Duplicate Signup (Same Email) ---');
      const dupRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/signup',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          name: 'Test User Duplicate',
          email: testEmail,
          password: testPassword,
        }
      );
      console.log('Response:', dupRes);
      assert(dupRes.status === 400, 'Duplicate signup rejected with status 400');
      assert(dupRes.data.success === false, 'Duplicate response success is false');

      // 3. User Login
      console.log('\n--- TEST 3: User Login ---');
      const loginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: testEmail,
          password: testPassword,
        }
      );
      console.log('Response:', loginRes);
      assert(loginRes.status === 200, 'Login returned status 200');
      assert(loginRes.data.success === true, 'Login success is true');
      assert(loginRes.data.role === undefined, 'No role in response root');
      assert(loginRes.data.user.role === undefined, 'No role in response user object');
      assert(typeof loginRes.data.token === 'string', 'Token returned on login');
      userToken = loginRes.data.token;

      // 4. Authenticated Profile GET /api/auth/me
      console.log('\n--- TEST 4: GET /api/auth/me ---');
      const meRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      });
      console.log('Response:', meRes);
      assert(meRes.status === 200, 'GET /api/auth/me returns status 200');
      assert(meRes.data.user.email === testEmail, 'Profile email matches');

      // Cleanup test user
      await User.deleteMany({ email: testEmail });
      console.log('\nCleaned up test user from database.');

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
