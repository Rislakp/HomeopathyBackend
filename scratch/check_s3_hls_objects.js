const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function run() {
  try {
    console.log(`Checking S3 bucket "${bucket}" for prefix "hls/"...`);
    const res = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'hls/',
      MaxKeys: 50,
    }));
    console.log(`KeyCount: ${res.KeyCount}`);
    if (res.Contents && res.Contents.length > 0) {
      console.log('Sample HLS objects in S3:');
      for (const item of res.Contents.slice(0, 20)) {
        console.log(` - ${item.Key} (${item.Size} bytes)`);
      }
    } else {
      console.log('NO objects found with prefix "hls/" in S3!');
    }
  } catch (err) {
    console.error('S3 List error:', err.message);
  }
}

run();

