const https = require('https');

function ping(password = 'test_wrong_password') {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      email: 'admin@whitecodeacademy.com',
      password: password
    });

    const req = https.request('https://homeopathybackend-1.onrender.com/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

async function checkDeployment() {
  console.log('Checking live Render endpoint: POST /api/admin/auth/login ...');
  for (let i = 1; i <= 6; i++) {
    console.log(`\nAttempt ${i}/6:`);
    const res = await ping('wrong_pass');
    console.log('Status:', res.status);
    console.log('Response Message:', res.body ? res.body.message : res.error);

    if (res.body && res.body.message === 'Invalid email or password') {
      console.log('🎉 Render has deployed the public /api/admin/auth/login route successfully!');
      break;
    }
    if (i < 6) {
      console.log('Waiting 15 seconds for Render to finish building...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

checkDeployment();
