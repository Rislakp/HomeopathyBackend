const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
dotenv.config();

const { s3Client, bucket } = require('../config/s3');

async function searchS3() {
  const prefixes = ['pdfs/', 'videos/', 'images/', ''];
  for (const prefix of prefixes) {
    try {
      const res = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 100,
      }));
      console.log(`=== Prefix: "${prefix}" ===`);
      for (const obj of res.Contents || []) {
        if (obj.Key.toLowerCase().includes('pharmacy') || obj.Key.toLowerCase().includes('oct') || obj.Key.toLowerCase().includes('part-1') || obj.Key.toLowerCase().includes('notes')) {
          console.log(`Match: ${obj.Key} (${obj.Size} bytes)`);
        }
      }
    } catch (err) {
      console.error(`Error for prefix ${prefix}:`, err.message);
    }
  }
}

searchS3();
