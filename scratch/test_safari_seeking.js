const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

async function timedRangeGet(url, range, abortAfterBytes = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const start = Date.now();
    let firstByteTime = null;
    let bytesReceived = 0;

    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        Origin: 'https://student.whitecoat.academy',
        Range: range,
      },
    }, (res) => {
      res.on('data', (chunk) => {
        if (!firstByteTime) firstByteTime = Date.now();
        bytesReceived += chunk.length;
        if (abortAfterBytes && bytesReceived >= abortAfterBytes) {
          req.destroy();
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            ttfbMs: firstByteTime - start,
            totalMs: Date.now() - start,
            bytesReceived,
            aborted: true,
          });
        }
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          ttfbMs: (firstByteTime || Date.now()) - start,
          totalMs: Date.now() - start,
          bytesReceived,
          aborted: false,
        });
      });
    });

    req.on('error', (err) => {
      if (abortAfterBytes && bytesReceived >= abortAfterBytes) {
        // Expected destroy
        return;
      }
      reject(err);
    });

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
  }), { expiresIn: 7200 });

  console.log('Target S3 Key:', targetKey);
  console.log('Testing iPhone Safari request timeline...\n');

  // Step 1: Range 0-1 (Safari initial probe)
  console.log('1. Safari Probe: bytes=0-1');
  const r1 = await timedRangeGet(signedUrl, 'bytes=0-1');
  console.log(`   Status: ${r1.statusCode}, TTFB: ${r1.ttfbMs}ms, Total: ${r1.totalMs}ms, Bytes: ${r1.bytesReceived}`);

  // Step 2: Safari reads moov metadata (0 to 3,211,043)
  console.log('2. Safari Moov Read: bytes=0-3211043 (3.21 MB)');
  const r2 = await timedRangeGet(signedUrl, 'bytes=0-3211043');
  console.log(`   Status: ${r2.statusCode}, TTFB: ${r2.ttfbMs}ms, Total: ${r2.totalMs}ms, Bytes: ${(r2.bytesReceived / (1024*1024)).toFixed(2)} MB`);

  // Step 3: Seek to position 1689s (saved progress of student).
  // In a 483MB 7263s file, average byte rate is ~66.6 KB/s.
  // 1689s is at offset ~112,500,000 (~112.5 MB).
  // When Safari seeks to 1689s, it requests bytes=112500000-
  console.log('3. Safari Seek to 1689s: Range: bytes=112500000- (reading first 2MB to decode keyframe)');
  const r3 = await timedRangeGet(signedUrl, 'bytes=112500000-', 2 * 1024 * 1024);
  console.log(`   Status: ${r3.statusCode}, TTFB: ${r3.ttfbMs}ms, Time to 2MB: ${r3.totalMs}ms`);

  // Step 4: Seek to middle 3600s (~241 MB)
  console.log('4. Safari Seek to 3600s: Range: bytes=241882422- (reading first 2MB to decode keyframe)');
  const r4 = await timedRangeGet(signedUrl, 'bytes=241882422-', 2 * 1024 * 1024);
  console.log(`   Status: ${r4.statusCode}, TTFB: ${r4.ttfbMs}ms, Time to 2MB: ${r4.totalMs}ms`);

  // Step 5: Seek near end 7000s (~466 MB)
  console.log('5. Safari Seek to 7000s: Range: bytes=466000000- (reading first 2MB)');
  const r5 = await timedRangeGet(signedUrl, 'bytes=466000000-', 2 * 1024 * 1024);
  console.log(`   Status: ${r5.statusCode}, TTFB: ${r5.ttfbMs}ms, Time to 2MB: ${r5.totalMs}ms`);

  // Step 6: Test Expired URL behavior
  console.log('\n6. Test Expired Signed URL');
  const expiredUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 1 });
  // Wait 2 seconds for it to expire
  await new Promise(r => setTimeout(r, 2000));
  try {
    const rExp = await timedRangeGet(expiredUrl, 'bytes=0-1');
    console.log(`   Expired URL status: ${rExp.statusCode}`);
  } catch (err) {
    console.log(`   Expired URL error:`, err.message);
  }
}

run();

