const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const https = require('https');
const { s3Client, bucket, region } = require('../config/s3');
const {
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  GetBucketCorsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { signS3Reference, normalizeS3Reference } = require('../utils/s3MediaSigner');

async function httpFetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const start = Date.now();
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
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
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('=== STEP 1: Connect to MongoDB & Find Course/Lesson ===');
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri);
      console.log('Connected to MongoDB Atlas');
      const Course = require('../models/Course');
      const courses = await Course.find({
        $or: [
          { 'modules.lessons.videoUrl': { $regex: 'pharmacy-5', $options: 'i' } },
          { 'modules.lessons.videoParts.s3Key': { $regex: 'pharmacy-5', $options: 'i' } },
          { 'modules.lessons.videoParts.url': { $regex: 'pharmacy-5', $options: 'i' } },
          { 'modules.lessons.lessonTitle': { $regex: 'pharmacy.*5', $options: 'i' } },
        ]
      }).lean();

      console.log(`Found ${courses.length} courses matching pharmacy-5`);
      for (const c of courses) {
        console.log(`Course: ${c.courseId} - ${c.courseTitle}`);
        for (const m of (c.modules || [])) {
          for (const l of (m.lessons || [])) {
            const hasP5 = JSON.stringify(l).toLowerCase().includes('pharmacy-5') ||
                          (l.lessonTitle && l.lessonTitle.toLowerCase().includes('pharmacy') && l.lessonTitle.includes('5'));
            if (hasP5) {
              console.log('Matching Lesson:', {
                lessonId: l._id,
                lessonTitle: l.lessonTitle,
                lessonType: l.lessonType,
                videoUrl: l.videoUrl ? l.videoUrl.split('?')[0] : null,
                s3Key: l.s3Key,
                videoS3Key: l.videoS3Key,
                storageProvider: l.storageProvider,
                videoParts: (l.videoParts || []).map(vp => ({
                  title: vp.title,
                  s3Key: vp.s3Key,
                  storageProvider: vp.storageProvider,
                  contentType: vp.contentType,
                  mp4S3Key: vp.mp4S3Key,
                })),
              });
            }
          }
        }
      }
    } catch (e) {
      console.log('Mongo error:', e.message);
    }
  }

  console.log('\n=== STEP 2: Find Objects in S3 matching pharmacy-5 ===');
  const list = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'videos/',
  }));
  const p5Keys = (list.Contents || []).filter(c => c.Key.toLowerCase().includes('pharmacy-5') || c.Key.toLowerCase().includes('pharmacy_5'));
  console.log('Matching S3 keys:', p5Keys.map(k => ({ Key: k.Key, Size: k.Size, LastModified: k.LastModified })));

  const targetKey = p5Keys.length > 0 ? p5Keys[0].Key : 'videos/1792902184026-c4f9d847-f9cc-40d0-8182-12b2ab343dee-pharmacy-5.mp4';
  console.log('\n=== STEP 3: S3 HeadObject for target key ===', targetKey);
  const head = await s3Client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: targetKey,
  }));
  console.log('HeadObject Result:', {
    ContentLength: head.ContentLength,
    ContentType: head.ContentType,
    AcceptRanges: head.AcceptRanges,
    ETag: head.ETag,
    Metadata: head.Metadata,
    ServerSideEncryption: head.ServerSideEncryption,
  });

  console.log('\n=== STEP 4: S3 Bucket CORS Configuration ===');
  try {
    const cors = await s3Client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log('CORS Rules:', JSON.stringify(cors.CORSRules, null, 2));
  } catch (e) {
    console.log('CORS fetch error:', e.message);
  }

  console.log('\n=== STEP 5: Test Presigned URL Generation ===');
  const signedRef = await signS3Reference({ storageProvider: 's3', s3Key: targetKey }, 'video/mp4');
  console.log('Signed reference returned URL starts with:', signedRef.url.split('?')[0]);
  const signedUrl = signedRef.url;

  console.log('\n=== STEP 6: Safari Video Requests Simulation ===');

  // Request 1: Initial request (Safari initial probe: Range: bytes=0-1)
  console.log('\n--- 6.1: Safari Initial Range probe (bytes=0-1) ---');
  const resInitial = await httpFetch(signedUrl, { Range: 'bytes=0-1' });
  console.log('Status:', resInitial.statusCode);
  console.log('Headers:', {
    'content-type': resInitial.headers['content-type'],
    'content-range': resInitial.headers['content-range'],
    'content-length': resInitial.headers['content-length'],
    'accept-ranges': resInitial.headers['accept-ranges'],
    'access-control-allow-origin': resInitial.headers['access-control-allow-origin'],
    'access-control-expose-headers': resInitial.headers['access-control-expose-headers'],
    'content-disposition': resInitial.headers['content-disposition'],
  });
  console.log('Received bytes:', resInitial.body.length);

  // Request 2: Safari header probe (bytes=0-131071 to inspect moov)
  console.log('\n--- 6.2: First 128KB Range (bytes=0-131071) ---');
  const resHead = await httpFetch(signedUrl, { Range: 'bytes=0-131071' });
  console.log('Status:', resHead.statusCode);
  console.log('Content-Range:', resHead.headers['content-range']);
  console.log('Content-Length:', resHead.headers['content-length']);

  // Parse MP4 atoms in head
  const headBuf = resHead.body;
  let offset = 0;
  const atoms = [];
  while (offset + 8 <= headBuf.length) {
    const sz = headBuf.readUInt32BE(offset);
    const type = headBuf.toString('ascii', offset + 4, offset + 8);
    atoms.push({ type, sz, offset });
    if (sz === 0 || sz > 1000000000) break;
    offset += (sz === 1 ? 16 : sz);
  }
  console.log('First atoms in file:', atoms);

  // Request 3: Seeking to middle of video
  const totalSize = head.ContentLength;
  const middleStart = Math.floor(totalSize / 2);
  const middleEnd = middleStart + 262143; // 256KB
  console.log(`\n--- 6.3: Seek to Middle (bytes=${middleStart}-${middleEnd}) ---`);
  const resMiddle = await httpFetch(signedUrl, { Range: `bytes=${middleStart}-${middleEnd}` });
  console.log('Status:', resMiddle.statusCode);
  console.log('Content-Range:', resMiddle.headers['content-range']);
  console.log('Content-Length:', resMiddle.headers['content-length']);
  console.log('Duration (ms):', resMiddle.durationMs);

  // Request 4: Seeking near end of video
  const endStart = totalSize - 262144;
  console.log(`\n--- 6.4: Seek Near End (bytes=${endStart}-${totalSize - 1}) ---`);
  const resEnd = await httpFetch(signedUrl, { Range: `bytes=${endStart}-${totalSize - 1}` });
  console.log('Status:', resEnd.statusCode);
  console.log('Content-Range:', resEnd.headers['content-range']);
  console.log('Content-Length:', resEnd.headers['content-length']);
  console.log('Duration (ms):', resEnd.durationMs);

  // Check if moov is at end of file
  let moovAtEnd = false;
  let moovEndOffset = -1;
  const endBuf = resEnd.body;
  for (let i = 0; i <= endBuf.length - 8; i++) {
    if (endBuf.toString('ascii', i + 4, i + 8) === 'moov') {
      moovAtEnd = true;
      moovEndOffset = endStart + i;
      const moovSz = endBuf.readUInt32BE(i);
      console.log(`🚨 FOUND MOOV AT END OF FILE! Offset: ${moovEndOffset}, Size: ${moovSz} bytes`);
      break;
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

