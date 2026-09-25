const http = require('http');
const express = require('express');
const cors = require('cors');

// Import exact server logic or create app matching server.js
async function runTests() {
  const allowedOrigins = [
    'https://whitecoat.academy',
    'https://www.whitecoat.academy',
    'https://admin.whitecoat.academy',
    'https://student.whitecoat.academy',
    'https://student-portal.whitecoat.academy',
    'https://whitecoatacademy.com',
    'https://www.whitecoatacademy.com',
    'https://admin.whitecoatacademy.com',
    'https://student.whitecoatacademy.com',
    'https://whitecodeacademy.com',
    'https://www.whitecodeacademy.com',
    'https://admin.whitecodeacademy.com',
    'https://student.whitecodeacademy.com',
  ];

  const isOriginAllowed = (origin) => {
    if (!origin) return true; // Mobile apps, Postman, curl, server-to-server

    // Direct allowlist match
    if (allowedOrigins.includes(origin)) return true;

    // Localhost & dynamic development origins (Flutter web, Vite, React, etc.)
    // Matches any port on localhost, 127.0.0.1, [::1], 0.0.0.0, 10.0.2.2 (Android emulator), and LAN IPs
    const isLocalOrDevOrigin =
      /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
      /^https?:\/\/\[::1\](:\d+)?$/i.test(origin) ||
      /^https?:\/\/0\.0\.0\.0(:\d+)?$/i.test(origin) ||
      /^https?:\/\/10\.0\.2\.2(:\d+)?$/i.test(origin) ||
      /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin) ||
      /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin) ||
      /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(origin);

    if (isLocalOrDevOrigin) {
      return true;
    }

    // Domain regex checks for official domains & subdomains
    const domainPatterns = [
      /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoat\.academy$/i,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecoatacademy\.com$/i,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*whitecodeacademy\.com$/i,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*onrender\.com$/i,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/i,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*netlify\.app$/i,
    ];

    if (domainPatterns.some((pattern) => pattern.test(origin))) {
      return true;
    }

    // Mobile WebViews and hybrid app schemes
    if (
      origin.startsWith('file://') ||
      origin.startsWith('capacitor://') ||
      origin.startsWith('ionic://') ||
      origin.startsWith('tauri://') ||
      origin.startsWith('app://')
    ) {
      return true;
    }

    return false;
  };

  const corsOptions = {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'x-student-id',
      'x-user-id',
      'Accept',
      'Origin',
      'X-Requested-With',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'ETag', 'Authorization'],
    optionsSuccessStatus: 200,
    maxAge: 86400,
  };

  const app = express();

  // 1. Explicit CORS headers & preflight OPTIONS interceptor (guarantees preflight response for Flutter web & browsers)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
      const reqHeaders = req.headers['access-control-request-headers'];
      const defaultHeaders = 'Authorization, Content-Type, x-student-id, x-user-id, Accept, Origin, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers';
      res.setHeader('Access-Control-Allow-Headers', reqHeaders ? `${defaultHeaders}, ${reqHeaders}` : defaultHeaders);
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // 2. Standard CORS middleware
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  app.get('/api/test', (req, res) => res.json({ success: true, message: 'ok' }));
  app.post('/api/test', (req, res) => res.json({ success: true, message: 'posted' }));

  const server = http.createServer(app);
  await new Promise(r => server.listen(5123, r));

  const testCases = [
    {
      name: 'Flutter Web dynamic port OPTIONS preflight: http://localhost:61972',
      origin: 'http://localhost:61972',
      method: 'OPTIONS',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'http://localhost:61972',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      },
      expectAllowOrigin: 'http://localhost:61972',
      expectStatus: 200,
    },
    {
      name: 'Flutter Web dynamic port POST request: http://localhost:61972',
      origin: 'http://localhost:61972',
      method: 'POST',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'http://localhost:61972',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test'
      },
      expectAllowOrigin: 'http://localhost:61972',
      expectStatus: 200,
    },
    {
      name: '127.0.0.1 dynamic port OPTIONS preflight: http://127.0.0.1:49821',
      origin: 'http://127.0.0.1:49821',
      method: 'OPTIONS',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'http://127.0.0.1:49821',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type'
      },
      expectAllowOrigin: 'http://127.0.0.1:49821',
      expectStatus: 200,
    },
    {
      name: 'Standard localhost:3000 GET request',
      origin: 'http://localhost:3000',
      method: 'GET',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'http://localhost:3000'
      },
      expectAllowOrigin: 'http://localhost:3000',
      expectStatus: 200,
    },
    {
      name: 'Production student origin OPTIONS preflight: https://student.whitecoatacademy.com',
      origin: 'https://student.whitecoatacademy.com',
      method: 'OPTIONS',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'https://student.whitecoatacademy.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type'
      },
      expectAllowOrigin: 'https://student.whitecoatacademy.com',
      expectStatus: 200,
    },
    {
      name: 'Untrusted origin: https://malicious-attacker.com',
      origin: 'https://malicious-attacker.com',
      method: 'OPTIONS',
      path: '/api/test',
      reqHeaders: {
        'Origin': 'https://malicious-attacker.com',
        'Access-Control-Request-Method': 'GET'
      },
      expectAllowOrigin: null,
      expectStatus: 200,
    }
  ];

  let allPassed = true;
  for (const tc of testCases) {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 5123,
        method: tc.method,
        path: tc.path,
        headers: tc.reqHeaders
      }, (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

    console.log(`\n--- Test: ${tc.name} ---`);
    console.log(`Status: ${res.status} (expected ${tc.expectStatus})`);
    console.log(`Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin']}`);
    console.log(`Access-Control-Allow-Methods: ${res.headers['access-control-allow-methods']}`);
    console.log(`Access-Control-Allow-Headers: ${res.headers['access-control-allow-headers']}`);
    console.log(`Access-Control-Allow-Credentials: ${res.headers['access-control-allow-credentials']}`);

    let pass = (res.status === tc.expectStatus);
    if (tc.expectAllowOrigin) {
      if (res.headers['access-control-allow-origin'] !== tc.expectAllowOrigin) pass = false;
      if (!res.headers['access-control-allow-methods']?.includes('GET') ||
          !res.headers['access-control-allow-methods']?.includes('POST') ||
          !res.headers['access-control-allow-methods']?.includes('PUT') ||
          !res.headers['access-control-allow-methods']?.includes('PATCH') ||
          !res.headers['access-control-allow-methods']?.includes('DELETE') ||
          !res.headers['access-control-allow-methods']?.includes('OPTIONS')) {
        pass = false;
        console.error('Missing expected methods in Access-Control-Allow-Methods');
      }
      if (!res.headers['access-control-allow-headers']?.toLowerCase().includes('authorization') ||
          !res.headers['access-control-allow-headers']?.toLowerCase().includes('content-type')) {
        pass = false;
        console.error('Missing expected headers in Access-Control-Allow-Headers');
      }
    } else {
      if (res.headers['access-control-allow-origin']) {
        pass = false;
        console.error('Origin was allowed when it should have been blocked');
      }
    }

    if (pass) {
      console.log('✅ PASSED');
    } else {
      console.error('❌ FAILED');
      allPassed = false;
    }
  }

  server.close();
  if (allPassed) {
    console.log('\n🎉 ALL CORS TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('\n❌ SOME CORS TESTS FAILED!');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
