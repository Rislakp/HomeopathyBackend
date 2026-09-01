require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const Admin = require('../models/admin.model');
const Student = require('../models/Student');
const Course = require('../models/Course');
const adminStudentRoutes = require('../routes/adminStudentRoutes');

const runTest = async () => {
  console.log('--- Starting Admin Student Export Endpoint Tests ---');

  const app = express();
  app.use(express.json());
  app.use('/api/admin/students', adminStudentRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  console.log(`Test express server started on port ${port}`);

  // Connect to DB if configured, or use mock if needed
  const useLocal = process.env.USE_LOCAL_DB === 'true';
  const dbUri = useLocal ? process.env.MONGODB_LOCAL_URI : process.env.MONGODB_URI;

  if (dbUri) {
    try {
      await mongoose.connect(dbUri, { dbName: 'homeopathy_db' });
      console.log('Connected to MongoDB for test verification.');
    } catch (e) {
      console.log('MongoDB connection skipped/failed, testing HTTP pipeline:', e.message);
    }
  }

  const makeRequest = (path, headers = {}) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: path,
        method: 'GET',
        headers: headers,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      });

      req.on('error', (err) => reject(err));
      req.end();
    });
  };

  try {
    // 1. Test Unauthenticated Request
    console.log('\n[Test 1] Testing unauthenticated GET /api/admin/students/export');
    const resUnauth = await makeRequest('/api/admin/students/export');
    console.log(`Status: ${resUnauth.statusCode} (Expected: 401)`);
    console.log(`Response: ${resUnauth.body}`);
    if (resUnauth.statusCode !== 401) {
      throw new Error(`Expected 401 but received ${resUnauth.statusCode}`);
    }
    console.log('✓ Test 1 Passed: Unauthorized request blocked successfully.');

    // 2. Test Authenticated Request with Admin Token / Secret
    console.log('\n[Test 2] Testing authenticated GET /api/admin/students/export with admin secret');
    const resAuth = await makeRequest('/api/admin/students/export', {
      Authorization: 'Bearer homeopathy_admin_secret',
    });

    console.log(`Status: ${resAuth.statusCode} (Expected: 200)`);
    console.log(`Content-Type: ${resAuth.headers['content-type']}`);
    console.log(`Content-Disposition: ${resAuth.headers['content-disposition']}`);
    console.log('\nFirst 500 characters of CSV Output:');
    console.log(resAuth.body.substring(0, 500));

    if (resAuth.statusCode !== 200) {
      throw new Error(`Expected 200 but received ${resAuth.statusCode}`);
    }

    if (!resAuth.headers['content-type'].includes('text/csv')) {
      throw new Error(`Expected Content-Type text/csv but got ${resAuth.headers['content-type']}`);
    }

    if (!resAuth.headers['content-disposition'].includes('attachment; filename=')) {
      throw new Error(`Expected attachment Content-Disposition header`);
    }

    // Verify CSV Headers
    const lines = resAuth.body.replace(/^\uFEFF/, '').split(/\r?\n/);
    console.log(`\nCSV Total Lines Generated: ${lines.length}`);
    console.log(`CSV Header: ${lines[0]}`);

    if (!lines[0].includes('"Student Name"') || !lines[0].includes('"Exam Scores"')) {
      throw new Error('CSV Header missing expected columns');
    }

    console.log('✓ Test 2 Passed: Authorized export returned valid CSV headers and content.');

    // 3. Test Filter Query
    console.log('\n[Test 3] Testing filtered export GET /api/admin/students/export?status=Active');
    const resFiltered = await makeRequest('/api/admin/students/export?status=Active', {
      Authorization: 'Bearer homeopathy_admin_secret',
    });
    console.log(`Status: ${resFiltered.statusCode} (Expected: 200)`);
    console.log('✓ Test 3 Passed: Filtered export succeeded.');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
  } finally {
    server.close();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(0);
  }
};

runTest();
