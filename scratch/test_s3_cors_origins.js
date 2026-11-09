const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');
const { signS3Reference } = require('../utils/s3MediaSigner');

async function testOrigins() {
  const samplePdfKey = 'pdfs/1792160106666-d6b9f997-e23d-466e-a7f9-8bb73b4d0a26-Homoeopathic-Pharmacy-Notes-LECT-2-1-.pdf';
  const signed = await signS3Reference({ storageProvider: 's3', s3Key: samplePdfKey }, 'application/pdf');
  const url = signed.url;

  const testOrigins = [
    'https://whitecoat.academy',
    'https://student.whitecoat.academy',
    'https://student.whitecoatacademy.com',
    'https://admin.whitecoat.academy',
    'https://www.whitecoat.academy',
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  for (const origin of testOrigins) {
    const res = await new Promise((resolve) => {
      const parsed = new URL(url);
      const req = https.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Origin': origin,
          'Range': 'bytes=0-512',
        },
      }, (r) => {
        resolve({
          status: r.statusCode,
          allowOrigin: r.headers['access-control-allow-origin'],
          exposeHeaders: r.headers['access-control-expose-headers'],
        });
      });
      req.end();
    });

    console.log(`Origin: ${origin.padEnd(40)} -> Status: ${res.status}, ACAO: ${res.allowOrigin || '(NONE - CORS BLOCKED)'}, Expose: ${res.exposeHeaders || '(none)'}`);
  }
}

testOrigins();
