const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function listS3Recordings() {
  for (const prefix of ['videos/', 'live_records/']) {
    console.log(`\n=== S3 Objects with prefix: ${prefix} ===`);
    let continuationToken;
    do {
      const res = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 100,
      }));
      for (const obj of res.Contents || []) {
        console.log(`  ${obj.Key.padEnd(80)} | ${(obj.Size / (1024 * 1024)).toFixed(2).padStart(8)} MB | ${obj.LastModified.toISOString()}`);
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
  }
}

listS3Recordings();
