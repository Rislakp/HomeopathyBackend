/**
 * End-to-end test: production presigned URL generation and S3 access.
 * Tests both PDF and video keys.
 * Does NOT log full URLs or credentials.
 * 
 * Run: node scratch/test_e2e_presign.js
 */
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https');

dotenv.config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

function request(url, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://student.whitecoat.academy',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
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

function fetchS3(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // Follow redirects manually
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchS3(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        let errorBody = '';
        if (res.statusCode >= 400) {
          try { errorBody = body.toString('utf-8').substring(0, 500); } catch {}
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          dataLength: body.length,
          errorBody
        });
      });
    }).on('error', reject);
  });
}

function analyzeUrl(label, url) {
  console.log(`\n--- ${label} URL Analysis ---`);
  const parsed = new URL(url);
  console.log('Host:', parsed.hostname);
  console.log('Path:', parsed.pathname);
  
  const params = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    params[key] = value;
  }
  
  // Check for + in the raw URL string
  console.log('Raw URL has literal + chars:', url.includes('+') ? 'YES' : 'NO');
  console.log('Raw URL has %2B:', url.includes('%2B') ? 'YES' : 'NO');
  
  if (params['X-Amz-Security-Token']) {
    const token = params['X-Amz-Security-Token'];
    console.log(`X-Amz-Security-Token: [${token.length} chars]`);
    console.log('  Token has + chars (decoded):', token.includes('+') ? 'YES' : 'NO');
  } else {
    console.log('X-Amz-Security-Token: NOT PRESENT (permanent credentials)');
  }
  
  if (params['X-Amz-Credential']) {
    console.log('X-Amz-Credential prefix:', params['X-Amz-Credential'].substring(0, 4));
  }
  console.log('X-Amz-Algorithm:', params['X-Amz-Algorithm'] || 'not set');
  console.log('X-Amz-Expires:', params['X-Amz-Expires'] || 'not set');
  
  return params;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } }).lean();

  const token = jwt.sign({
    id: admin._id.toString(),
    _id: admin._id.toString(),
    userId: admin._id.toString(),
    role: admin.role || 'admin',
    email: admin.email
  }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const testKeys = [
    { label: 'PDF', key: 'pdfs/1791091521866-c6991950-12c3-4dfd-ba72-79eaa69d08d7-pharmacy-note-pt-1.docx-1-.pdf' },
    { label: 'Video', key: 'videos/1791091513421-cee79365-6193-48da-8210-975a9e7e6a8a-pharmacy-1.mp4' },
  ];

  for (const { label, key } of testKeys) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing ${label}: ${key}`);
    console.log('='.repeat(60));

    // 1. Get presigned URL from production
    const res = await request(
      `https://api.whitecoat.academy/api/s3-upload/media/access-url?s3Key=${encodeURIComponent(key)}`,
      'GET', null, token
    );
    console.log('\nAPI Status:', res.status);
    
    if (res.status !== 200 || !res.body?.url) {
      console.log('API Response:', JSON.stringify(res.body, null, 2));
      continue;
    }

    console.log('API success:', res.body.success);
    console.log('Returned s3Key:', res.body.s3Key);
    console.log('expiresIn:', res.body.expiresIn);

    // 2. Analyze the returned URL structure
    const params = analyzeUrl(label, res.body.url);

    // 3. Actually fetch the S3 object to test the URL
    console.log(`\n--- ${label} S3 Fetch Test ---`);
    try {
      const s3Res = await fetchS3(res.body.url);
      console.log('S3 HTTP Status:', s3Res.statusCode);
      console.log('S3 Content-Type:', s3Res.headers['content-type']);
      console.log('S3 Content-Length:', s3Res.headers['content-length']);
      console.log('Downloaded Bytes:', s3Res.dataLength);
      if (s3Res.statusCode >= 400) {
        console.log('S3 Error:', s3Res.errorBody);
      } else {
        console.log('✅ S3 access SUCCESSFUL');
      }
    } catch (err) {
      console.log('❌ S3 fetch error:', err.message);
    }
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
