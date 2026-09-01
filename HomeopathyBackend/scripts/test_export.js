require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const adminStudentRoutes = require('../routes/adminStudentRoutes');

const runTest = async () => {
  console.log('--- Starting Admin Student Route Ordering & Export Tests ---');

  const app = express();
  app.use(express.json());
  app.use('/api/admin/students', adminStudentRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  console.log(`Test express server running on port ${port}`);

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
    // 1. Test GET /api/admin/students/export with admin auth (Route ordering check)
    console.log('\n[Test 1] Testing GET /api/admin/students/export - ensures it hits /export instead of /:id');
    const resExport = await makeRequest('/api/admin/students/export', {
      Authorization: 'Bearer homeopathy_admin_secret',
    });

    console.log(`Status: ${resExport.statusCode} (Expected: 200)`);
    console.log(`Content-Type: ${resExport.headers['content-type']}`);
    console.log(`Content-Disposition: ${resExport.headers['content-disposition']}`);

    if (resExport.statusCode !== 200) {
      throw new Error(`Expected 200 for /export, but received ${resExport.statusCode}: ${resExport.body}`);
    }

    if (!resExport.headers['content-type'].includes('text/csv')) {
      throw new Error(`Expected Content-Type text/csv but got ${resExport.headers['content-type']}`);
    }

    console.log('✓ Test 1 Passed: /export correctly routed to export handler (not intercepted by /:id).');

    // 2. Test GET /api/admin/students/:id with invalid ID
    console.log('\n[Test 2] Testing GET /api/admin/students/invalid-mongo-id');
    const resInvalidId = await makeRequest('/api/admin/students/invalid-mongo-id', {
      Authorization: 'Bearer homeopathy_admin_secret',
    });

    console.log(`Status: ${resInvalidId.statusCode} (Expected: 400)`);
    console.log(`Body: ${resInvalidId.body}`);

    if (resInvalidId.statusCode !== 400) {
      throw new Error(`Expected 400 for invalid ID format, but received ${resInvalidId.statusCode}`);
    }
    console.log('✓ Test 2 Passed: Dynamic /:id handler correctly receives ID requests.');

    // 3. Test GET /api/admin/students/:id with valid formatted Mongo ID (not found)
    console.log('\n[Test 3] Testing GET /api/admin/students/507f1f77bcf86cd799439011');
    const resNotFound = await makeRequest('/api/admin/students/507f1f77bcf86cd799439011', {
      Authorization: 'Bearer homeopathy_admin_secret',
    });

    console.log(`Status: ${resNotFound.statusCode} (Expected: 404)`);
    console.log(`Body: ${resNotFound.body}`);

    if (resNotFound.statusCode !== 404) {
      throw new Error(`Expected 404 for non-existent student, but received ${resNotFound.statusCode}`);
    }
    console.log('✓ Test 3 Passed: /:id handler processed valid ObjectId correctly.');

    console.log('\n🎉 ALL ROUTE ORDERING TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ Route test failed:', err);
  } finally {
    server.close();
    process.exit(0);
  }
};

runTest();
