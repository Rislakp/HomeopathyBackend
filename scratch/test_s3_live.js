const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');
const { GetObjectCommand, HeadObjectCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket, region } = require('../config/s3');
const { signS3Reference, encodeSignedUrl } = require('../utils/s3MediaSigner');

async function testS3Live() {
  console.log('=== S3 Live Diagnostic ===');
  console.log('Bucket:', bucket);
  console.log('Region:', region);

  // 1. Check Bucket CORS Configuration
  try {
    const cors = await s3Client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log('\n[Bucket CORS Configuration]');
    console.log(JSON.stringify(cors.CORSRules, null, 2));
  } catch (err) {
    console.error('\n[Bucket CORS Check Failed]', err.name, err.message);
  }

  // 2. Pick a real PDF from the DB
  const samplePdfKey = 'pdfs/1792160106666-d6b9f997-e23d-466e-a7f9-8bb73b4d0a26-Homoeopathic-Pharmacy-Notes-LECT-2-1-.pdf';
  console.log('\nTesting PDF key:', samplePdfKey);

  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: samplePdfKey }));
    console.log('HeadObject Success:');
    console.log('  ContentLength:', head.ContentLength);
    console.log('  ContentType:', head.ContentType);
    console.log('  AcceptRanges:', head.AcceptRanges);
    console.log('  LastModified:', head.LastModified);
  } catch (err) {
    console.error('HeadObject Failed:', err.name, err.message);
  }

  // 3. Generate Signed URL for PDF
  const signedPdfRef = await signS3Reference({ storageProvider: 's3', s3Key: samplePdfKey }, 'application/pdf');
  const pdfUrl = signedPdfRef.url;
  console.log('\nGenerated PDF signed URL (domain & query params):');
  const parsedPdfUrl = new URL(pdfUrl);
  console.log('Host:', parsedPdfUrl.hostname);
  console.log('Path:', parsedPdfUrl.pathname);
  for (const [k, v] of parsedPdfUrl.searchParams.entries()) {
    if (k === 'X-Amz-Signature') console.log(`  ${k}: [redacted]`);
    else console.log(`  ${k}: ${v}`);
  }

  // 4. Test HTTP request with Origin header (simulating Student Portal in browser)
  console.log('\nTesting HTTP GET with Origin: https://whitecoat.academy (Full GET)');
  await makeHttpRequest(pdfUrl, {
    'Origin': 'https://whitecoat.academy',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
  });

  // 5. Test HTTP Range request with Origin header (simulating PDF.js streaming / Android PDF viewer)
  console.log('\nTesting HTTP Range GET (bytes=0-1023) with Origin: https://whitecoat.academy');
  await makeHttpRequest(pdfUrl, {
    'Origin': 'https://whitecoat.academy',
    'Range': 'bytes=0-1023',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
  });

  // 6. Test Video key
  const sampleVideoKey = 'videos/1792112100076-0875b876-5f13-448d-83db-e09d87673b31-screen-capture-rep-1.mp4';
  console.log('\nTesting Video key:', sampleVideoKey);
  const signedVideoRef = await signS3Reference({ storageProvider: 's3', s3Key: sampleVideoKey }, 'video/mp4');
  const videoUrl = signedVideoRef.url;
  
  console.log('\nTesting Video Range GET (bytes=0-1023) with Origin: https://whitecoat.academy');
  await makeHttpRequest(videoUrl, {
    'Origin': 'https://whitecoat.academy',
    'Range': 'bytes=0-1023',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
}

function makeHttpRequest(url, headers) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const start = Date.now();
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
      timeout: 10000,
    }, (res) => {
      const elapsed = Date.now() - start;
      console.log(`Response Status: ${res.statusCode} (took ${elapsed}ms)`);
      console.log('Headers:');
      console.log('  content-type:', res.headers['content-type']);
      console.log('  content-disposition:', res.headers['content-disposition']);
      console.log('  content-range:', res.headers['content-range']);
      console.log('  content-length:', res.headers['content-length']);
      console.log('  accept-ranges:', res.headers['accept-ranges']);
      console.log('  access-control-allow-origin:', res.headers['access-control-allow-origin']);
      console.log('  access-control-allow-methods:', res.headers['access-control-allow-methods']);
      console.log('  access-control-expose-headers:', res.headers['access-control-expose-headers']);
      console.log('  cache-control:', res.headers['cache-control']);
      console.log('  server:', res.headers['server']);
      
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => {
        console.log(`  bytes received: ${bytes}`);
        resolve();
      });
    });

    req.on('timeout', () => {
      console.error('Request timed out after 10000ms');
      req.destroy();
      resolve();
    });

    req.on('error', (err) => {
      console.error('Request Error:', err.message);
      resolve();
    });

    req.end();
  });
}

testS3Live();
