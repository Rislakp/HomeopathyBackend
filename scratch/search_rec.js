const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function search() {
  const res = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'videos/1791471476238',
  }));
  console.log('Results:', res.Contents);
}
search();
