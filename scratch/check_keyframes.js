const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { execSync } = require('child_process');

async function run() {
  const targetKey = 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4';
  const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket, Key: targetKey,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });

  console.log('Probing keyframes for first 120 seconds...');
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries frame=pkt_pts_time,key_frame -read_intervals "%+120" -print_format json "${signedUrl}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const parsed = JSON.parse(out);
    const keyframes = (parsed.frames || []).filter(f => f.key_frame === 1);
    console.log(`Found ${keyframes.length} keyframes in first 120s:`);
    console.log(keyframes.slice(0, 15).map(f => f.pkt_pts_time));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

run();

