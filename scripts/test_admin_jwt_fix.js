require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Admin = require('../models/admin.model');
const User = require('../models/User');

const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
app.use('/api/admin/auth', require('../routes/adminAuthRoutes'));
app.use('/api/auth', require('../routes/authRoutes'));
app.use(require('../routes/exam.routes'));
app.use('/api/v1/admin', require('../routes/adminRoutes'));

function makeRequest(options, postData, isMultipart = false, multipartBuffer = null, boundary = '') {
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

    if (multipartBuffer) {
      req.write(multipartBuffer);
    } else if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('Connecting to database...');
  await connectDB();

  const timestamp = Date.now();
  const adminEmail = `testadmin_${timestamp}@whitecodeacademy.com`;
  const adminPassword = 'AdminSecret2026!';

  // Create test admin
  const testAdmin = await Admin.create({
    name: 'Test Admin User',
    email: adminEmail,
    password: adminPassword,
    role: 'ADMIN',
    isActive: true,
  });

  const TEST_PORT = 5098;
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`RUNNING ADMIN AUTHENTICATION & JWT FIX TEST SUITE`);
    console.log(`======================================================\n`);

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
      // 1. Admin Login via /api/admin/auth/login
      console.log('--- TEST 1: Admin Login ---');
      const loginRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/admin/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        {
          email: adminEmail,
          password: adminPassword,
        }
      );

      assert(loginRes.status === 200, 'Admin login HTTP 200', loginRes);
      assert(loginRes.data && loginRes.data.success === true, 'Login success true');
      const token = loginRes.data?.data?.token || loginRes.data?.token;
      assert(typeof token === 'string' && token.length > 50, 'Valid JWT token returned');

      // 2. Decode JWT and verify userId and role exist in payload
      console.log('\n--- TEST 2: Inspect JWT Payload ---');
      const decoded = jwt.decode(token);
      console.log('Decoded JWT payload:', decoded);
      assert(!!decoded.userId, 'JWT contains userId field', decoded);
      assert(decoded.userId === testAdmin._id.toString(), 'JWT userId matches admin._id');
      assert(!!decoded.role, 'JWT contains role field', decoded);
      assert(decoded.role.toLowerCase() === 'admin', 'JWT role is admin');

      // 3. Call protected endpoint POST /api/exams/extract-mcqs with the Admin JWT
      console.log('\n--- TEST 3: Call POST /api/exams/extract-mcqs with Admin JWT ---');
      // Prepare multipart/form-data with a sample text file / empty file to verify auth passes
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from('Content-Disposition: form-data; name="pdf"; filename="sample.pdf"\r\n'),
        Buffer.from('Content-Type: application/pdf\r\n\r\n'),
        Buffer.from('%PDF-1.4\n%dummy pdf content\n'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const examRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/exams/extract-mcqs',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': multipartBody.length,
          },
        },
        null,
        true,
        multipartBody,
        boundary
      );

      console.log('Response from /api/exams/extract-mcqs:', examRes.status, examRes.data);
      assert(examRes.status !== 401, 'Request was NOT rejected with 401 Invalid token / User ID missing');
      assert(examRes.status !== 403, 'Request was NOT rejected with 403 Forbidden');
      assert(examRes.status === 200 || examRes.status === 500, 'Auth passed through requireAdmin to endpoint');

      // 4. Test Protected Admin Students endpoint
      console.log('\n--- TEST 4: Call Protected /api/v1/admin/students ---');
      const studentsRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/admin/students',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('Response from /api/v1/admin/students:', studentsRes.status, studentsRes.data?.message);
      assert(studentsRes.status === 200, 'Admin students list retrieved successfully');

      // 5. Test with legacy token format { adminId: "..." } to verify backward compatibility
      console.log('\n--- TEST 5: Backward compatibility with legacy token payload ---');
      const secret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
      const legacyToken = jwt.sign(
        {
          adminId: testAdmin._id.toString(),
          email: testAdmin.email,
          role: 'ADMIN',
        },
        secret,
        { expiresIn: '1d' }
      );

      const legacyExamRes = await makeRequest(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/exams/extract-mcqs',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${legacyToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': multipartBody.length,
          },
        },
        null,
        true,
        multipartBody,
        boundary
      );

      console.log('Response with legacy token:', legacyExamRes.status, legacyExamRes.data);
      assert(legacyExamRes.status !== 401, 'Legacy token auth also passes without 401');

      console.log(`\n======================================================`);
      console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
      console.log(`======================================================\n`);

    } catch (err) {
      console.error('Test execution error:', err);
    } finally {
      // Clean up test admin
      await Admin.deleteOne({ _id: testAdmin._id });
      server.close();
      await mongoose.disconnect();
      process.exit(failed > 0 ? 1 : 0);
    }
  });
}

runTests().catch(console.error);
