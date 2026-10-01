const http = require('http');

async function testSingle() {
  const { app, startServer } = require('../server');
  await startServer();
  console.log('Server started. Sending request to /health...');

  const req = http.request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/health',
    method: 'GET'
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Response status:', res.statusCode);
      console.log('Response body:', data);
      process.exit(0);
    });
  });

  req.on('error', err => {
    console.error('Request error:', err);
    process.exit(1);
  });

  req.end();
}

testSingle();
