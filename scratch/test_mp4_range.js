const https = require('https');

const candidateKeys = [
  'videos/1792902657064-bdf23c77-0a88-4a38-bee9-20e63d706f9f-pharmacy-5.mp4',
  'videos/1794377388545-409d7492-e1f2-49d3-b8e3-df71d37aec23-1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4',
  'videos/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4'
];

function makeRequest(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          bodyLength: Buffer.concat(chunks).length,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function testVideo(key) {
  const url = `https://media.whitecoat.academy/${key}`;
  console.log(`\n================ Testing: ${url} ================`);

  // 1. HEAD request
  try {
    const headRes = await makeRequest(url, {}, 'HEAD');
    console.log('[HEAD Request]');
    console.log('Status:', headRes.statusCode);
    console.log('Accept-Ranges:', headRes.headers['accept-ranges']);
    console.log('Content-Length:', headRes.headers['content-length']);
    console.log('Content-Type:', headRes.headers['content-type']);
    console.log('ETag:', headRes.headers['etag']);
    console.log('Via:', headRes.headers['via']);
    console.log('X-Cache:', headRes.headers['x-cache']);
  } catch (err) {
    console.log('[HEAD Error]', err.message);
  }

  // 2. Normal GET (first 100 bytes via range or full if no range)
  // Let's do a Range request: bytes=0-1000
  try {
    const rangeRes1 = await makeRequest(url, { 'Range': 'bytes=0-1000' });
    console.log('\n[Range GET: bytes=0-1000]');
    console.log('Status:', rangeRes1.statusCode);
    console.log('Accept-Ranges:', rangeRes1.headers['accept-ranges']);
    console.log('Content-Range:', rangeRes1.headers['content-range']);
    console.log('Content-Length:', rangeRes1.headers['content-length']);
    console.log('Content-Type:', rangeRes1.headers['content-type']);
    console.log('Received bytes:', rangeRes1.bodyLength);
    console.log('X-Cache:', rangeRes1.headers['x-cache']);
  } catch (err) {
    console.log('[Range GET 1 Error]', err.message);
  }

  // 3. Forward seek Range request: bytes=10000000-10050000 (middle of file)
  try {
    const rangeRes2 = await makeRequest(url, { 'Range': 'bytes=10000000-10050000' });
    console.log('\n[Forward Seek Range GET: bytes=10000000-10050000]');
    console.log('Status:', rangeRes2.statusCode);
    console.log('Content-Range:', rangeRes2.headers['content-range']);
    console.log('Content-Length:', rangeRes2.headers['content-length']);
    console.log('Received bytes:', rangeRes2.bodyLength);
    console.log('X-Cache:', rangeRes2.headers['x-cache']);
  } catch (err) {
    console.log('[Forward Seek Range Error]', err.message);
  }

  // 4. Backward seek Range request: bytes=2000000-2050000
  try {
    const rangeRes3 = await makeRequest(url, { 'Range': 'bytes=2000000-2050000' });
    console.log('\n[Backward Seek Range GET: bytes=2000000-2050000]');
    console.log('Status:', rangeRes3.statusCode);
    console.log('Content-Range:', rangeRes3.headers['content-range']);
    console.log('Content-Length:', rangeRes3.headers['content-length']);
    console.log('Received bytes:', rangeRes3.bodyLength);
    console.log('X-Cache:', rangeRes3.headers['x-cache']);
  } catch (err) {
    console.log('[Backward Seek Range Error]', err.message);
  }

  // 5. Open-ended Range request (similar to Safari: bytes=99221504-)
  try {
    const rangeRes4 = await makeRequest(url, { 'Range': 'bytes=99221504-99321504' });
    console.log('\n[Safari-style Range GET: bytes=99221504-99321504]');
    console.log('Status:', rangeRes4.statusCode);
    console.log('Content-Range:', rangeRes4.headers['content-range']);
    console.log('Content-Length:', rangeRes4.headers['content-length']);
    console.log('Received bytes:', rangeRes4.bodyLength);
    console.log('X-Cache:', rangeRes4.headers['x-cache']);
  } catch (err) {
    console.log('[Safari-style Range Error]', err.message);
  }
}

async function run() {
  for (const k of candidateKeys) {
    await testVideo(k);
  }
}
run();

