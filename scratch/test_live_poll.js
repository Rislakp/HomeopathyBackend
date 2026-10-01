const https = require('https');

function ping() {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ email: 'admin@whitecodeacademy.com', password: 'wrong_test_password' });
    const req = https.request('https://homeopathybackend-1.onrender.com/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', err => resolve({ error: err.message }));
    req.write(payload);
    req.end();
  });
}

async function run() {
  for (let i = 1; i <= 15; i++) {
    const r = await ping();
    console.log(`[${i}/15] Status: ${r.status}, Body: ${r.body || r.error}`);
    if (r.body && r.body.includes('Invalid email or password')) {
      console.log('✅ LIVE RENDER DEPLOYMENT CONFIRMED: /api/admin/auth/login is public and reached controller!');
      break;
    }
    await new Promise(res => setTimeout(res, 10000));
  }
}
run();
