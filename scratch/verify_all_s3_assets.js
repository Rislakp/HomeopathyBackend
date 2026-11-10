require('dotenv').config();
const { HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket } = require('../config/s3');
const { execSync } = require('child_process');
const https = require('https');

const KEYS_TO_VERIFY = [
  'videos/1793013512772-1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1_faststart.mp4',
  'videos/1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1.mp4',
  'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4',
  'videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4',
  'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4',
  'videos/1790917963406-0c036483-Recording-2026-08-20-135459.mp4',
  'videos/1792902184026-c4f9d847-f9cc-40d0-8182-12b2ab343dee-pharmacy-5.mp4',
  'videos/1792902657064-bdf23c77-0a88-4a38-bee9-20e63d706f9f-pharmacy-5.mp4'
];

async function checkRangeAndMoov(signedUrl) {
  return new Promise((resolve) => {
    const req = https.request(signedUrl, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-32767' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const moovIdx = buf.indexOf(Buffer.from('moov'));
        const mdatIdx = buf.indexOf(Buffer.from('mdat'));
        const faststart = moovIdx !== -1 && (mdatIdx === -1 || moovIdx < mdatIdx);
        resolve({
          statusCode: res.statusCode,
          contentRange: res.headers['content-range'],
          acceptRanges: res.headers['accept-ranges'],
          contentType: res.headers['content-type'],
          faststart,
          moovOffset: moovIdx,
          mdatOffset: mdatIdx
        });
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.end();
  });
}

async function verify() {
  console.log('Verifying target keys in S3:');
  for (const key of KEYS_TO_VERIFY) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Checking key: ${key}`);
    try {
      const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`HeadObject: Size=${(head.ContentLength / (1024*1024)).toFixed(2)} MB | ContentType=${head.ContentType} | AcceptRanges=${head.AcceptRanges}`);

      const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: 'video/mp4',
        ResponseContentDisposition: 'inline'
      }), { expiresIn: 3600 });

      const rangeRes = await checkRangeAndMoov(signedUrl);
      console.log(`Range Test (bytes 0-32767): Status=${rangeRes.statusCode} | ContentRange=${rangeRes.contentRange} | FastStart=${rangeRes.faststart} (moovOffset=${rangeRes.moovOffset})`);

      // Probe with ffprobe
      const probeJson = execSync(`ffprobe -v error -show_format -show_streams -print_format json "${signedUrl}"`, { encoding: 'utf8', timeout: 30000 });
      const probe = JSON.parse(probeJson);
      const v = probe.streams?.find(s => s.codec_type === 'video');
      const a = probe.streams?.find(s => s.codec_type === 'audio');
      const duration = parseFloat(probe.format?.duration || '0');
      console.log(`FFprobe: duration=${duration.toFixed(1)}s | video=${v?.codec_name} (${v?.width}x${v?.height}, pix_fmt=${v?.pix_fmt}) | audio=${a?.codec_name} (${a?.sample_rate}Hz)`);

      // Test 3-point seek decode (10%, 50%, 90%)
      const t1 = Math.max(1, Math.floor(duration * 0.1));
      const t2 = Math.floor(duration * 0.5);
      const t3 = Math.floor(duration * 0.9);
      console.log(`Seek decode test at ${t1}s, ${t2}s, ${t3}s...`);
      for (const t of [t1, t2, t3]) {
        execSync(`ffmpeg -v error -ss ${t} -i "${signedUrl}" -vframes 1 -f null -`, { timeout: 20000 });
      }
      console.log(`Seek decode test: ALL PASSED`);

    } catch (e) {
      console.error(`Error on key ${key}:`, e.message);
    }
  }
}

verify().catch(console.error);

