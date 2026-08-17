require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const connectDB = require('../config/db');

async function runValidation() {
  console.log('--- Starting Backend & CORS Verification ---');

  // Verify MongoDB
  console.log('1. Verifying MongoDB Connection...');
  await connectDB();
  console.log('✅ MongoDB Connected successfully.');

  // Create Express app with same CORS setup as server.js
  const app = express();

  const allowedOrigins = [
    'https://whitecoat.academy',
    'https://admin.whitecoat.academy',
  ];

  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',').forEach((origin) => {
      const trimmed = origin.trim();
      if (trimmed && !allowedOrigins.includes(trimmed)) {
        allowedOrigins.push(trimmed);
      }
    });
  }

  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocalhost) {
        return callback(null, true);
      }
      return callback(new Error(`CORS error: Origin ${origin} not allowed by CORS policy`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-student-id', 'x-user-id', 'Accept', 'Origin', 'X-Requested-With'],
    optionsSuccessStatus: 200,
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json());

  // Mount existing routes to verify they load and respond
  app.use('/api/auth', require('../routes/authRoutes'));
  app.use('/api/courses', require('../routes/courseRoutes'));
  app.use(require('../routes/lesson.routes'));
  app.use(require('../routes/exam.routes'));
  app.use(require('../src/student/student.routes'));
  app.use(require('../src/admin/admin.routes'));
  const adminRoutes = require('../routes/adminRoutes');
  app.use('/api/admin/auth', require('../routes/adminAuthRoutes'));
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/v1/students', adminRoutes);
  app.use('/api/students', adminRoutes);

  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Backend is working',
    });
  });

  // Global Error Handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal Server Error'
    });
  });

  const TEST_PORT = 5088;
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`📡 Test server running on http://127.0.0.1:${TEST_PORT}\n`);
      resolve();
    });
  });

  const testCases = [
    {
      name: '1. Root endpoint without Origin header (curl/mobile apps)',
      method: 'GET',
      path: '/',
      headers: {},
      expectedStatus: 200
    },
    {
      name: '2. Root endpoint with Origin: https://whitecoat.academy',
      method: 'GET',
      path: '/',
      headers: { 'Origin': 'https://whitecoat.academy' },
      expectedStatus: 200,
      expectedAllowOrigin: 'https://whitecoat.academy'
    },
    {
      name: '3. Preflight OPTIONS with Origin: https://whitecoat.academy',
      method: 'OPTIONS',
      path: '/api/auth/login',
      headers: {
        'Origin': 'https://whitecoat.academy',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      },
      expectedStatus: [200, 204],
      expectedAllowOrigin: 'https://whitecoat.academy'
    },
    {
      name: '4. Root endpoint with Origin: https://admin.whitecoat.academy',
      method: 'GET',
      path: '/',
      headers: { 'Origin': 'https://admin.whitecoat.academy' },
      expectedStatus: 200,
      expectedAllowOrigin: 'https://admin.whitecoat.academy'
    },
    {
      name: '5. Preflight OPTIONS with Origin: https://admin.whitecoat.academy',
      method: 'OPTIONS',
      path: '/api/admin/auth/login',
      headers: {
        'Origin': 'https://admin.whitecoat.academy',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      },
      expectedStatus: [200, 204],
      expectedAllowOrigin: 'https://admin.whitecoat.academy'
    },
    {
      name: '6. Localhost development Origin: http://localhost:3000',
      method: 'GET',
      path: '/',
      headers: { 'Origin': 'http://localhost:3000' },
      expectedStatus: 200,
      expectedAllowOrigin: 'http://localhost:3000'
    },
    {
      name: '7. Flutter Web local development Origin: http://localhost:54321',
      method: 'OPTIONS',
      path: '/api/courses',
      headers: {
        'Origin': 'http://localhost:54321',
        'Access-Control-Request-Method': 'GET'
      },
      expectedStatus: [200, 204],
      expectedAllowOrigin: 'http://localhost:54321'
    },
    {
      name: '8. 127.0.0.1 local development Origin: http://127.0.0.1:8080',
      method: 'GET',
      path: '/',
      headers: { 'Origin': 'http://127.0.0.1:8080' },
      expectedStatus: 200,
      expectedAllowOrigin: 'http://127.0.0.1:8080'
    },
    {
      name: '9. Unauthorized origin rejected: https://unauthorized-domain.com',
      method: 'GET',
      path: '/',
      headers: { 'Origin': 'https://unauthorized-domain.com' },
      expectCorsRejected: true
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: tc.path,
        method: tc.method,
        headers: tc.headers
      });

      console.log(`Test: ${tc.name}`);
      console.log(`  -> Status: ${res.statusCode}`);
      console.log(`  -> Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin'] || '(none)'}`);

      if (tc.expectCorsRejected) {
        if (res.statusCode >= 400 || !res.headers['access-control-allow-origin']) {
          console.log(`  ✅ Passed (Blocked as expected)\n`);
          passed++;
        } else {
          console.error(`  ❌ Failed: Disallowed origin was allowed!\n`);
          failed++;
        }
      } else {
        const statusMatch = Array.isArray(tc.expectedStatus)
          ? tc.expectedStatus.includes(res.statusCode)
          : res.statusCode === tc.expectedStatus;

        const originMatch = tc.expectedAllowOrigin
          ? res.headers['access-control-allow-origin'] === tc.expectedAllowOrigin
          : true;

        if (statusMatch && originMatch) {
          console.log(`  ✅ Passed\n`);
          passed++;
        } else {
          console.error(`  ❌ Failed (statusMatch: ${statusMatch}, originMatch: ${originMatch})\n`);
          failed++;
        }
      }
    } catch (err) {
      if (tc.expectCorsRejected) {
        console.log(`Test: ${tc.name}`);
        console.log(`  ✅ Passed (Connection rejected)\n`);
        passed++;
      } else {
        console.error(`Test: ${tc.name}`);
        console.error(`  ❌ Request error:`, err.message, '\n');
        failed++;
      }
    }
  }

  console.log(`========================================`);
  console.log(`Summary: ${testCases.length} Tests | ${passed} Passed | ${failed} Failed`);
  console.log(`========================================`);

  server.close();
  const mongoose = require('mongoose');
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

runValidation();
