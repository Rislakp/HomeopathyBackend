const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function run() {
  const res = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'hls/PHARMACY-4/',
    MaxKeys: 30,
  }));
  console.log(`Objects in hls/PHARMACY-4/: ${res.KeyCount}`);
  for (const item of (res.Contents || [])) {
    console.log(` - ${item.Key} (${item.Size} bytes)`);
  }
}

run().catch(e => console.error(e));

