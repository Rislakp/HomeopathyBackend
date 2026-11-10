const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');

async function checkRecordingObject() {
  const head = await s3Client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: 'videos/1791471476238-24b212e5-PART-1_recording.webm'
  }));
  console.log('Recording Object Metadata:');
  console.log('  ContentLength:', head.ContentLength);
  console.log('  ContentType:', head.ContentType);
  console.log('  LastModified:', head.LastModified);
  console.log('  ETag:', head.ETag);
}
checkRecordingObject();
