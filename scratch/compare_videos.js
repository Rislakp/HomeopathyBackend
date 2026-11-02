const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const https = require('https');

async function getRange(url, range) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol, hostname: parsed.hostname, port: 443,
      path: parsed.pathname + parsed.search, method: 'GET',
      headers: { Range: range }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function inspect(key) {
  const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = head.ContentLength;
  const url = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket, Key: key,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });

  const r = await getRange(url, 'bytes=0-131071');
  const buf = r.buf;
  let offset = 0;
  const atoms = [];
  while (offset + 8 <= buf.length) {
    const sz = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    atoms.push({ type, sz });
    if (sz === 0 || sz > 500000000) break;
    offset += (sz === 1 ? 16 : sz);
  }

  console.log(`[${key.split('-').pop()}] ${key}`);
  console.log(`  Size: ${(size / (1024*1024)).toFixed(2)} MB (${size} bytes)`);
  console.log(`  Atoms in first 128KB:`, atoms);
}

async function run() {
  const keys = [
    'videos/1791091513421-cee79365-6193-48da-8210-975a9e7e6a8a-pharmacy-1.mp4',
    'videos/1792821074022-ca59de93-427e-4fba-97c9-7a301044c493-PHARMACY-PART-2.mp4',
    'videos/1792828847737-77d94ce3-63b3-4a93-a376-b7794f2c13ae-pharmacy-3.mp4',
    'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
    'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4',
    'videos/1793003835374-fc45a34f-bac7-44ec-b670-31762e816bce-pharmacy-6.mp4',
  ];
  for (const k of keys) {
    try {
      await inspect(k);
    } catch (e) {
      console.log(`Error on ${k}:`, e.message);
    }
  }
}

run();

