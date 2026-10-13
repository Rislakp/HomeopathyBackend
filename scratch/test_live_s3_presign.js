const jwt = require('jsonwebtoken');
const https = require('https');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

const JWT_SECRET = process.env.JWT_SECRET;

async function request(url, method = 'GET', body = null, token = null) {
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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          dataLength: Buffer.concat(chunks).length
        });
      });
    }).on('error', reject);
  });
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
  }, JWT_SECRET, { expiresIn: '1h' });

  const testKey = 'grand_mock_questions/1791350500726-3d63c815-demo-image-question.png';
  console.log(`Requesting signed media access URL for key: ${testKey}`);

  const res = await request(`https://api.whitecoat.academy/api/s3-upload/media/access-url?s3Key=${encodeURIComponent(testKey)}`, 'GET', null, token);
  console.log('Status from access-url endpoint:', res.status);
  console.log('Body:', JSON.stringify(res.body, null, 2));

  if (res.body?.url) {
    console.log('\nFetching signed URL from S3 directly...');
    const s3Res = await fetchUrl(res.body.url);
    console.log('S3 HTTP Status:', s3Res.statusCode);
    console.log('S3 Content-Type:', s3Res.headers['content-type']);
    console.log('S3 Content-Length:', s3Res.headers['content-length']);
    console.log('Downloaded Bytes:', s3Res.dataLength);
  }

  await mongoose.disconnect();
}

main();
