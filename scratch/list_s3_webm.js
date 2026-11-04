const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');

async function listWebm() {
  let continuationToken = null;
  const webms = [];
  do {
    const res = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'videos/',
      ContinuationToken: continuationToken
    }));
    for (const obj of res.Contents || []) {
      if (obj.Key.toLowerCase().endsWith('.webm')) {
        webms.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  console.log('Total webm files in S3:', webms.length);
  for (const w of webms) {
    console.log(JSON.stringify(w));
  }
}

listWebm().catch(err => {
  console.error('S3 error:', err);
  process.exit(1);
});
