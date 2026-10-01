const { S3Client } = require('@aws-sdk/client-s3');

const accessKeyId = (
  process.env.AWS_ACCESS_KEY_ID ||
  process.env.S3_ACCESS_KEY ||
  process.env.AWS_KEY ||
  ''
).trim().replace(/^["']|["']$/g, '');

const secretAccessKey = (
  process.env.AWS_SECRET_ACCESS_KEY ||
  process.env.S3_SECRET_KEY ||
  process.env.AWS_SECRET ||
  ''
).trim().replace(/^["']|["']$/g, '');

const sessionToken = (
  process.env.AWS_SESSION_TOKEN ||
  process.env.AWS_SECURITY_TOKEN ||
  ''
).trim().replace(/^["']|["']$/g, '');

const region = (
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  process.env.S3_REGION ||
  'us-east-1'
).trim().replace(/^["']|["']$/g, '');

const bucket = (
  process.env.AWS_S3_BUCKET ||
  process.env.S3_BUCKET ||
  process.env.AWS_BUCKET ||
  process.env.S3_BUCKET_NAME ||
  'whitecoat-media-prod'
).trim().replace(/^["']|["']$/g, '');

const publicBaseUrl = (process.env.AWS_S3_PUBLIC_BASE_URL || '').trim().replace(/^["']|["']$/g, '');
const customEndpoint = (
  process.env.AWS_ENDPOINT ||
  process.env.AWS_S3_ENDPOINT ||
  process.env.S3_ENDPOINT ||
  ''
).trim().replace(/^["']|["']$/g, '');

const clientConfig = { region };

if (accessKeyId && secretAccessKey) {
  clientConfig.credentials = {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

if (customEndpoint) {
  clientConfig.endpoint = customEndpoint;
}

const s3Client = new S3Client(clientConfig);

console.info('[S3 Config]', {
  region,
  bucket,
  hasCredentials: Boolean(accessKeyId && secretAccessKey),
  hasSessionToken: Boolean(sessionToken),
  hasCustomEndpoint: Boolean(customEndpoint),
  publicBaseUrl: publicBaseUrl || '(none)',
});

/**
 * Helper to check whether AWS S3 is active and properly configured
 */
const isS3Configured = () => {
  if (process.env.STORAGE_PROVIDER === 'cloudinary') return false;
  if (!bucket) return false;
  return Boolean(
    (accessKeyId && secretAccessKey) ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE
  );
};

module.exports = {
  s3Client,
  bucket,
  region,
  publicBaseUrl,
  isS3Configured,
};

