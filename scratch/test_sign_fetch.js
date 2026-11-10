const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

async function testSign() {
  const targetKey = 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4';
  const url = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });
  console.log('Signed URL:', url.substring(0, 120) + '...');
  const res = await fetch(url, { headers: { Range: 'bytes=0-100' } });
  console.log('Status:', res.status, res.statusText);
  if (res.status !== 206) {
    const text = await res.text();
    console.log('Body:', text);
  } else {
    console.log('Success! Headers:', Object.fromEntries(res.headers.entries()));
  }
}
testSign().catch(console.error);

