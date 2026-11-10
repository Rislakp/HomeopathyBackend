const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
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

async function inspectKey(key) {
  const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = head.ContentLength;
  const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });

  if (key.endsWith('.webm')) {
    console.log('\n[WEBM]', key, (size/(1024*1024)).toFixed(2), 'MB');
    try {
      const info = execSync(`ffprobe -v error -show_entries stream=codec_name,codec_type -print_format json "${url}"`, { encoding: 'utf-8', timeout: 15000 });
      console.log('Streams:', JSON.parse(info).streams);
    } catch (e) {
      console.log('ffprobe error:', e.message);
    }
    return;
  }

  // Check first 128KB for moov vs mdat
  const headRange = await getRange(url, 'bytes=0-131071');
  const buf = headRange.buf;
  let offset = 0;
  let firstAtoms = [];
  while (offset + 8 <= buf.length) {
    const sz = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    firstAtoms.push({ type, sz, offset });
    if (sz === 0 || sz > 100000000) break;
    offset += (sz === 1 ? 16 : sz);
  }
  const moovInHead = firstAtoms.some(a => a.type === 'moov');
  const mdatInHead = firstAtoms.some(a => a.type === 'mdat');
  let fastStart = moovInHead && (!mdatInHead || firstAtoms.findIndex(a => a.type === 'moov') < firstAtoms.findIndex(a => a.type === 'mdat'));

  let moovAtEnd = false;
  if (!fastStart) {
    const tailStart = Math.max(0, size - 262144);
    const tailRange = await getRange(url, `bytes=${tailStart}-${size - 1}`);
    for (let i = 0; i <= tailRange.buf.length - 8; i++) {
      if (tailRange.buf.toString('ascii', i + 4, i + 8) === 'moov') {
        moovAtEnd = true;
        break;
      }
    }
  }

  // Get stream codecs for MP4
  let streamsDesc = '';
  try {
    const info = execSync(`ffprobe -v error -show_entries stream=codec_name,codec_type -print_format json "${url}"`, { encoding: 'utf-8', timeout: 15000 });
    streamsDesc = JSON.parse(info).streams.map(s => `${s.codec_type}:${s.codec_name}`).join(', ');
  } catch (e) {
    streamsDesc = `probe err: ${e.message}`;
  }

  console.log(`[MP4] ${key} (${(size/(1024*1024)).toFixed(2)} MB)`);
  console.log(`      FastStart: ${fastStart} | moovAtEnd: ${moovAtEnd} | Codecs: [${streamsDesc}]`);
  console.log(`      First atoms: ${firstAtoms.map(a => a.type).join(', ')}`);
}

async function run() {
  const keys = [
    'videos/1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1.webm',
    'videos/1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3.webm',
    'videos/1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1.webm',
    'videos/1791091513421-cee79365-6193-48da-8210-975a9e7e6a8a-pharmacy-1.mp4',
    'videos/1792821074022-ca59de93-427e-4fba-97c9-7a301044c493-PHARMACY-PART-2.mp4',
    'videos/1792828847737-77d94ce3-63b3-4a93-a376-b7794f2c13ae-pharmacy-3.mp4',
    'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
    'videos/1792902184026-c4f9d847-f9cc-40d0-8182-12b2ab343dee-pharmacy-5.mp4',
    'videos/1793003835374-fc45a34f-bac7-44ec-b670-31762e816bce-pharmacy-6.mp4',
    'videos/1791980638147-fded4ce0-6f6b-4635-8102-e57a4c1921a7-Respiratory-2.mp4',
    'videos/1792821032732-810f354a-8343-4794-8026-d910d3c39607-BTP-PART-1.mp4',
    'videos/1792510679227-16378318-dddd-4d1f-be54-dc442132d434-BTP-2.mp4',
  ];
  for (const k of keys) {
    await inspectKey(k);
  }
}
run();
