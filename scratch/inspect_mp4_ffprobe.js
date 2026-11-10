const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../models/Course');
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const https = require('https');
const { execSync } = require('child_process');

async function getRange(url, range) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol, hostname: parsed.hostname, port: 443,
      path: parsed.pathname + parsed.search, method: 'GET',
      headers: { Range: range, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buf: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function inspectMp4(key, courseTitle, lessonTitle) {
  console.log(`\n================================================================`);
  console.log(`Course: "${courseTitle}" | Lesson: "${lessonTitle}"`);
  console.log(`S3 Key: ${key}`);

  let head;
  try {
    head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.log(`  ERROR: S3 HeadObject failed: ${err.message}`);
    return;
  }

  const size = head.ContentLength;
  console.log(`  Size: ${(size / (1024 * 1024)).toFixed(2)} MB (${size} bytes)`);
  console.log(`  S3 ContentType: ${head.ContentType}`);
  console.log(`  S3 AcceptRanges: ${head.AcceptRanges}`);

  const url = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });

  // 1. Verify HTTP Range delivery (bytes=0-1023)
  const rangeTest = await getRange(url, 'bytes=0-1023');
  console.log(`  Range 0-1023 Status: ${rangeTest.status}`);
  console.log(`  Response Content-Type: ${rangeTest.headers['content-type']}`);
  console.log(`  Response Content-Range: ${rangeTest.headers['content-range']}`);
  console.log(`  Response Content-Length: ${rangeTest.headers['content-length']}`);
  console.log(`  Response Accept-Ranges: ${rangeTest.headers['accept-ranges']}`);
  console.log(`  Response Cache-Control: ${rangeTest.headers['cache-control'] || '(none)'}`);

  // 2. Check Moov atom placement
  const headChunk = await getRange(url, 'bytes=0-131071');
  const buf = headChunk.buf;
  let offset = 0;
  const atoms = [];
  while (offset + 8 <= buf.length) {
    const sz = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    atoms.push({ type, sz, offset });
    if (sz === 0 || sz > 500000000) break;
    offset += (sz === 1 ? 16 : sz);
  }
  const moovInHead = atoms.some(a => a.type === 'moov');
  const mdatInHead = atoms.some(a => a.type === 'mdat');
  const moovIdx = atoms.findIndex(a => a.type === 'moov');
  const mdatIdx = atoms.findIndex(a => a.type === 'mdat');
  const fastStart = moovInHead && (!mdatInHead || moovIdx < mdatIdx);

  console.log(`  Atoms in first 128KB: ${atoms.map(a => a.type).join(', ')}`);
  console.log(`  FastStart (moov before mdat): ${fastStart ? 'YES (Optimal for iOS Safari)' : 'NO (moov at end or missing - Safari must fetch entire file!)'}`);

  // 3. Inspect codecs via ffprobe
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,bit_rate,duration -show_entries format=bit_rate,duration -print_format json "${url}"`;
    const vInfo = JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 15000 }));
    const vStream = vInfo.streams?.[0] || {};
    const fmt = vInfo.format || {};

    const aCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,profile,sample_rate,channels,bit_rate -print_format json "${url}"`;
    const aInfo = JSON.parse(execSync(aCmd, { encoding: 'utf-8', timeout: 15000 }));
    const aStream = aInfo.streams?.[0] || {};

    console.log(`  Video Stream:`);
    console.log(`    Codec: ${vStream.codec_name} (Profile: ${vStream.profile || 'unknown'})`);
    console.log(`    Pixel Format: ${vStream.pix_fmt}`);
    console.log(`    Resolution: ${vStream.width}x${vStream.height}`);
    console.log(`    Frame Rate: ${vStream.r_frame_rate}`);
    console.log(`    Video Bitrate: ${vStream.bit_rate ? (vStream.bit_rate / 1000).toFixed(0) + ' kbps' : 'unknown'}`);
    console.log(`    Duration: ${vStream.duration || fmt.duration}s`);
    console.log(`  Audio Stream:`);
    console.log(`    Codec: ${aStream.codec_name || '(no audio)'} (Profile: ${aStream.profile || 'unknown'})`);
    console.log(`    Sample Rate: ${aStream.sample_rate || 'unknown'} Hz`);
    console.log(`    Channels: ${aStream.channels || 'unknown'}`);
    console.log(`    Audio Bitrate: ${aStream.bit_rate ? (aStream.bit_rate / 1000).toFixed(0) + ' kbps' : 'unknown'}`);
    console.log(`  Overall Format Bitrate: ${fmt.bit_rate ? (fmt.bit_rate / 1000).toFixed(0) + ' kbps' : 'unknown'}`);

    // iOS Safari compatibility checklist
    const iosIssues = [];
    if (!fastStart) iosIssues.push('MOOV atom NOT at start (causes buffering/seeking stalls on iOS Safari)');
    if (vStream.pix_fmt && vStream.pix_fmt !== 'yuv420p') iosIssues.push(`Non-standard pixel format: ${vStream.pix_fmt} (iOS requires yuv420p)`);
    if (vStream.codec_name !== 'h264') iosIssues.push(`Incompatible video codec: ${vStream.codec_name} (iOS Safari requires H.264/AVC or H.265/HEVC)`);
    if (aStream.codec_name && aStream.codec_name !== 'aac') iosIssues.push(`Incompatible audio codec: ${aStream.codec_name} (iOS Safari requires AAC)`);
    if (vStream.profile && (vStream.profile.toLowerCase().includes('high 4:4:4') || vStream.profile.toLowerCase().includes('high 10'))) {
      iosIssues.push(`Incompatible H.264 profile: ${vStream.profile} (iOS Safari hardware decoder requires Constrained Baseline, Main, or High 4:2:0)`);
    }

    if (iosIssues.length === 0) {
      console.log(`  >>> iOS Safari Compatibility: COMPATIBLE`);
    } else {
      console.log(`  >>> iOS Safari Compatibility: ISSUES DETECTED:`);
      iosIssues.forEach(iss => console.log(`      * ${iss}`));
    }
  } catch (err) {
    console.log(`  ffprobe error: ${err.message}`);
  }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const courses = await Course.find({}).lean();
  const seenKeys = new Set();

  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const items = [...(l.videoParts || [])];
        if (l.videoS3Key || l.s3Key) items.push({ s3Key: l.videoS3Key || l.s3Key, title: l.lessonTitle });
        if (l.mp4S3Key) items.push({ s3Key: l.mp4S3Key, title: l.lessonTitle + ' (MP4 Fallback)' });

        for (const item of items) {
          const key = item.s3Key || '';
          if (typeof key === 'string' && key.toLowerCase().endsWith('.mp4') && !seenKeys.has(key)) {
            seenKeys.add(key);
            await inspectMp4(key, c.courseTitle, item.title || l.lessonTitle);
          }
        }
      }
    }
  }

  await mongoose.disconnect();
}

run();
