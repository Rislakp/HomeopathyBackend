const https = require('https');

async function testRenderHealth() {
  const start = Date.now();
  console.log('Testing live Render backend: https://homeopathybackend-1.onrender.com/api/health');
  
  return new Promise((resolve) => {
    const req = https.get('https://homeopathybackend-1.onrender.com/api/health', { timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - start;
        console.log(`Render Response Status: ${res.statusCode} (took ${elapsed}ms)`);
        console.log('Response body:', data);
        resolve();
      });
    });

    req.on('timeout', () => {
      console.log(`Request timed out after ${Date.now() - start}ms`);
      req.destroy();
      resolve();
    });

    req.on('error', (err) => {
      console.log(`Request failed after ${Date.now() - start}ms:`, err.message);
      resolve();
    });
  });
}

testRenderHealth();
