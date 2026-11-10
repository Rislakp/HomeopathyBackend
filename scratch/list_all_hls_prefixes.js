const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function run() {
  const res = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'hls/',
    Delimiter: '/',
  }));
  console.log('CommonPrefixes under hls/:');
  for (const cp of (res.CommonPrefixes || [])) {
    console.log(' -', cp.Prefix);
  }
}

run().catch(e => console.error(e));

