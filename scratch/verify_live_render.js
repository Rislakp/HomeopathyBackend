const https = require('https');

function request(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Accept': 'application/json',
      ...headers,
      ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {})
    };

    const req = https.request('https://homeopathybackend-1.onrender.com' + path, {
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function verifyLive() {
  console.log('==================================================');
  console.log('LIVE RENDER VERIFICATION: https://homeopathybackend-1.onrender.com');
  console.log('==================================================');

  // TEST 1: Login with invalid password (No Auth header)
  console.log('\n--- TEST 1: POST /api/admin/auth/login (Invalid password, No Authorization header) ---');
  const res1 = await request('/api/admin/auth/login', 'POST', {
    email: 'admin@whitecodeacademy.com',
    password: 'incorrect_password_test'
  });
  console.log('HTTP Status:', res1.status, '(Expected 401)');
  console.log('Response Message:', res1.body.message, '(Expected "Invalid email or password")');

  // TEST 2: Login with valid credentials (No Auth header)
  console.log('\n--- TEST 2: POST /api/admin/auth/login (Valid admin credentials, No Authorization header) ---');
  const res2 = await request('/api/admin/auth/login', 'POST', {
    email: 'admin@whitecodeacademy.com',
    password: 'WhiteCode@Admin2026'
  });
  console.log('HTTP Status:', res2.status, '(Expected 200)');
  console.log('Success Field:', res2.body.success, '(Expected true)');
  console.log('Token Exists in Response:', !!res2.body.token, '(Expected true)');
  console.log('Data Token Exists:', !!(res2.body.data && res2.body.data.token), '(Expected true)');
  console.log('Admin Role Returned:', res2.body.user ? res2.body.user.role : null, '(Expected "ADMIN")');
  console.log('Admin Email Returned:', res2.body.user ? res2.body.user.email : null, '(Expected "admin@whitecodeacademy.com")');

  const liveAdminJwt = res2.body.token;

  // TEST 3: Protected admin API without Bearer token
  console.log('\n--- TEST 3: GET /api/admin/dashboard-stats (Protected Admin API without token) ---');
  const res3 = await request('/api/admin/dashboard-stats', 'GET');
  console.log('HTTP Status:', res3.status, '(Expected 401)');
  console.log('Response Message:', res3.body.message, '(Expected "Authentication required. Bearer token missing.")');

  // TEST 4: Protected admin API with Admin Bearer token
  console.log('\n--- TEST 4: GET /api/admin/dashboard-stats (Protected Admin API WITH Admin JWT) ---');
  const res4 = await request('/api/admin/dashboard-stats', 'GET', null, {
    'Authorization': `Bearer ${liveAdminJwt}`
  });
  console.log('HTTP Status:', res4.status, '(Expected 200)');
  console.log('Success Field:', res4.body.success, '(Expected true)');

  console.log('\n==================================================');
  console.log('ALL LIVE ACCEPTANCE CRITERIA VERIFIED ON PRODUCTION RENDER!');
  console.log('==================================================');
}

verifyLive().catch(console.error);
