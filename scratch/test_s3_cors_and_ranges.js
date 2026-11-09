const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

async function doRequest(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const start = Date.now();
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          durationMs: Date.now() - start,
          bodyLength: chunks.reduce((acc, c) => acc + c.length, 0),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const targetKey = 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4';
  const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });

  console.log('Testing signed URL:', signedUrl.split('?')[0]);

  // 1. OPTIONS request with Origin
  console.log('\n--- Test 1: OPTIONS Preflight with Origin ---');
  const optRes = await doRequest(signedUrl, 'OPTIONS', {
    Origin: 'https://student.whitecoat.academy',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'range',
  });
  console.log('OPTIONS status:', optRes.statusCode);
  console.log('OPTIONS headers:', optRes.headers);

  // 2. GET with Origin and Range: bytes=0-1
  console.log('\n--- Test 2: GET with Origin and Range: bytes=0-1 ---');
  const getRes1 = await doRequest(signedUrl, 'GET', {
    Origin: 'https://student.whitecoat.academy',
    Range: 'bytes=0-1',
  });
  console.log('Status:', getRes1.statusCode);
  console.log('Headers:', {
    'content-type': getRes1.headers['content-type'],
    'content-range': getRes1.headers['content-range'],
    'content-length': getRes1.headers['content-length'],
    'accept-ranges': getRes1.headers['accept-ranges'],
    'access-control-allow-origin': getRes1.headers['access-control-allow-origin'],
    'access-control-expose-headers': getRes1.headers['access-control-expose-headers'],
    'access-control-allow-credentials': getRes1.headers['access-control-allow-credentials'],
    'content-disposition': getRes1.headers['content-disposition'],
  });

  // 3. GET with Origin and Range: bytes=0- (open-ended start)
  console.log('\n--- Test 3: GET with Origin and Range: bytes=0- (open-ended) ---');
  // We only want to see the headers, so abort after getting headers or read a small slice
  const parsed = new URL(signedUrl);
  const reqOpen = https.request({
    protocol: parsed.protocol, hostname: parsed.hostname, port: 443,
    path: parsed.pathname + parsed.search, method: 'GET',
    headers: {
      Origin: 'https://student.whitecoat.academy',
      Range: 'bytes=0-',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    }
  }, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', {
      'content-type': res.headers['content-type'],
      'content-range': res.headers['content-range'],
      'content-length': res.headers['content-length'],
      'accept-ranges': res.headers['accept-ranges'],
      'access-control-allow-origin': res.headers['access-control-allow-origin'],
      'access-control-expose-headers': res.headers['access-control-expose-headers'],
    });
    reqOpen.destroy(); // destroy immediately to avoid downloading 483MB
  });
  reqOpen.end();

  // 4. Test seeking byte ranges (e.g. 50% seek)
  console.log('\n--- Test 4: Seeking to 50% position with Origin ---');
  const midStart = 241882422;
  const midEnd = midStart + 524287; // 512KB slice
  const getResMid = await doRequest(signedUrl, 'GET', {
    Origin: 'https://student.whitecoat.academy',
    Range: `bytes=${midStart}-${midEnd}`,
  });
  console.log('Status:', getResMid.statusCode);
  console.log('Duration:', getResMid.durationMs, 'ms');
  console.log('Headers:', {
    'content-type': getResMid.headers['content-type'],
    'content-range': getResMid.headers['content-range'],
    'content-length': getResMid.headers['content-length'],
    'accept-ranges': getResMid.headers['accept-ranges'],
    'access-control-allow-origin': getResMid.headers['access-control-allow-origin'],
    'access-control-expose-headers': getResMid.headers['access-control-expose-headers'],
  });

  // 5. Test seeking near the end (99% seek)
  console.log('\n--- Test 5: Seeking near end (99%) with Origin ---');
  const endStart = 480000000;
  const endEnd = endStart + 524287;
  const getResEnd = await doRequest(signedUrl, 'GET', {
    Origin: 'https://student.whitecoat.academy',
    Range: `bytes=${endStart}-${endEnd}`,
  });
  console.log('Status:', getResEnd.statusCode);
  console.log('Duration:', getResEnd.durationMs, 'ms');
  console.log('Headers:', {
    'content-range': getResEnd.headers['content-range'],
    'content-length': getResEnd.headers['content-length'],
  });
}

run();

