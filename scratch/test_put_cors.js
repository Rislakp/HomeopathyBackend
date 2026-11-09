const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { PutBucketCorsCommand } = require('@aws-sdk/client-s3');

async function run() {
  try {
    const res = await s3Client.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: ['*'],
            ExposeHeaders: [
              'ETag',
              'Content-Type',
              'Content-Length',
              'Content-Disposition',
              'Content-Range',
              'Accept-Ranges',
            ],
            MaxAgeSeconds: 3600,
          }
        ]
      }
    }));
    console.log('PutBucketCors SUCCESS!', res);
  } catch (e) {
    console.log('PutBucketCors ERROR:', e.message);
  }
}

run();

