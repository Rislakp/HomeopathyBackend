const { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const https = require('https');
require('dotenv').config();

const { s3Client, bucket, region } = require('../config/s3');

async function measureHttpRange(url, rangeHeader) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        ...(rangeHeader ? { Range: rangeHeader } : {}),
        'User-Agent': 'HomeopathyBackend-Diagnostic/1.0',
      },
    }, (res) => {
      let ttfb = Date.now() - startTime;
      const chunks = [];
      let totalBytes = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
      });

      res.on('end', () => {
        const totalDuration = Date.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          ttfb,
          totalDuration,
          bytesReceived: totalBytes,
          buffer: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

async function inspectMp4(sampleVideo) {
  console.log(`\n======================================================`);
  console.log(`Inspecting: ${sampleVideo.Key} (${(sampleVideo.Size / (1024 * 1024)).toFixed(2)} MB)`);

  const headRes = await s3Client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: sampleVideo.Key,
  }));
  console.log(`Stored ContentType: ${headRes.ContentType}`);
  console.log(`ContentLength: ${headRes.ContentLength}`);

  // Test URL WITHOUT ResponseContentType (how studentCurriculumController / demoVideo currently generates it)
  const plainSignedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: sampleVideo.Key,
  }), { expiresIn: 3600 });

  const plainRes = await measureHttpRange(plainSignedUrl, 'bytes=0-1023');
  console.log(`Raw S3 served Content-Type: ${plainRes.headers['content-type']}`);
  console.log(`Raw S3 Accept-Ranges: ${plainRes.headers['accept-ranges']}`);
  console.log(`Raw S3 Content-Range: ${plainRes.headers['content-range']}`);
  console.log(`Raw S3 TTFB: ${plainRes.ttfb} ms`);

  if (sampleVideo.Key.endsWith('.mp4')) {
    // Read first 64KB
    const startRange = await measureHttpRange(plainSignedUrl, 'bytes=0-65535');
    const buf = startRange.buffer;
    let offset = 0;
    let moovFound = false;
    let moovOffset = -1;
    let mdatOffset = -1;
    const atoms = [];

    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      atoms.push({ type, size, offset });
      if (type === 'moov') {
        moovFound = true;
        moovOffset = offset;
      }
      if (type === 'mdat') {
        mdatOffset = offset;
      }
      if (size === 0 || size > 500000000) break;
      if (size === 1) offset += 16;
      else offset += size;
    }

    if (moovFound) {
      console.log(`Atom structure: moov at offset ${moovOffset} (FASTSTART OK)`);
    } else {
      console.log(`⚠️ ATOM ALERT: "moov" NOT in first 64KB! First atoms:`, atoms.map(a => a.type));
      // Check last 256KB
      const tailStart = Math.max(0, sampleVideo.Size - 262144);
      const tailRes = await measureHttpRange(plainSignedUrl, `bytes=${tailStart}-${sampleVideo.Size - 1}`);
      const tailBuf = tailRes.buffer;
      let tailFoundMoov = false;
      for (let i = 0; i <= tailBuf.length - 8; i++) {
        if (tailBuf.toString('ascii', i + 4, i + 8) === 'moov') {
          tailFoundMoov = true;
          console.log(`🚨 CRITICAL: "moov" found at END of file (offset ~${tailStart + i})! Non-faststart MP4!`);
          break;
        }
      }
      if (!tailFoundMoov) {
        console.log(`❓ "moov" not found in first 64KB or last 256KB.`);
      }
    }
  }
}

async function run() {
  const listRes = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'videos/',
    MaxKeys: 10,
  }));

  for (const item of listRes.Contents) {
    await inspectMp4(item);
  }
}

run();
