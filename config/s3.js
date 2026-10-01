const { S3Client } = require('@aws-sdk/client-s3');

const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || 'whitecoat-media-prod';

// Leave credentials to the AWS SDK default provider chain (EC2 instance role in production).
const s3Client = new S3Client({ region });

module.exports = { s3Client, bucket, region };
