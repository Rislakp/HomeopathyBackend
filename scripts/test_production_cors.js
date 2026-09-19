require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');

async function testCors() {
  console.log('Testing CORS configuration matching server.js exact setup...');

  // Exact setup from server.js
  const app = express();

  const allowedOrigins = [
    'https://whitecoat.academy',
    'https://www.whitecoat.academy',
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

  // Mount routes
  app.use('/api/auth', require('../routes/authRoutes'));

  // Error handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal Server Error'
    });
  });

  const TEST_PORT = 5099;
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(TEST_PORT, resolve));

  const testEndpoints = [
    {
      name: 'OPTIONS /api/auth/register from https://whitecoat.academy',
      method: 'OPTIONS',
      path: '/api/auth/register',
      origin: 'https://whitecoat.academy',
      headers: {
        'Origin': 'https://whitecoat.academy',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization,Accept'
      }
    },
    {
      name: 'OPTIONS /api/auth/register from https://www.whitecoat.academy',
      method: 'OPTIONS',
      path: '/api/auth/register',
      origin: 'https://www.whitecoat.academy',
      headers: {
        'Origin': 'https://www.whitecoat.academy',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization,Accept'
      }
    },
    {
      name: 'OPTIONS /api/auth/register from https://admin.whitecoat.academy',
      method: 'OPTIONS',
      path: '/api/auth/register',
      origin: 'https://admin.whitecoat.academy',
      headers: {
        'Origin': 'https://admin.whitecoat.academy',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization,Accept'
      }
    },
    {
      name: 'POST /api/auth/register (CORS headers check) from https://www.whitecoat.academy',
      method: 'POST',
      path: '/api/auth/register',
      origin: 'https://www.whitecoat.academy',
      headers: {
        'Origin': 'https://www.whitecoat.academy',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Test User', email: 'test_cors@example.com', password: 'Password123!' })
    }
  ];

  for (const test of testEndpoints) {
    const res = await new Promise(resolve => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: test.path,
        method: test.method,
        headers: test.headers
      }, r => {
        let b = '';
        r.on('data', d => b += d);
        r.on('end', () => resolve({ statusCode: r.statusCode, headers: r.headers, body: b }));
      });
      if (test.body) req.write(test.body);
      req.end();
    });

    console.log(`\n-----------------------------------------`);
    console.log(`Test: ${test.name}`);
    console.log(`Status: ${res.statusCode}`);
    console.log(`Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin']}`);
    console.log(`Access-Control-Allow-Credentials: ${res.headers['access-control-allow-credentials']}`);
    console.log(`Access-Control-Allow-Methods: ${res.headers['access-control-allow-methods']}`);
    console.log(`Access-Control-Allow-Headers: ${res.headers['access-control-allow-headers']}`);

    if (res.headers['access-control-allow-origin'] === test.origin) {
      console.log(` Result: PASSED`);
    } else {
      console.error(` Result: FAILED (Expected Origin: ${test.origin})`);
    }
  }

  server.close();
  process.exit(0);
}

testCors().catch(err => {
  console.error(err);
  process.exit(1);
});
