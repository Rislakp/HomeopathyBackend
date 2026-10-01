const { S3Client } = require('@aws-sdk/client-s3');

const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'whitecoat-media-prod';
const publicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL || '';

// If explicit AWS credentials are provided in process.env, configure them;
// otherwise fall back to the AWS SDK default provider chain (EC2 IAM role, ECS, etc.).
const clientConfig = { region };

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
  };
}

const s3Client = new S3Client(clientConfig);

/**
 * Helper to check whether AWS S3 is active
 */
const isS3Configured = () => {
  if (process.env.STORAGE_PROVIDER === 'cloudinary') return false;
  if (!bucket) return false;
  return true;
};

module.exports = {
  s3Client,
  bucket,
  region,
  publicBaseUrl,
  isS3Configured,
};
