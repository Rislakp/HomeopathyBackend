const { MediaConvertClient, DescribeEndpointsCommand } = require('@aws-sdk/client-mediaconvert');
const { s3Client, bucket, region } = require('./s3');

// Credentials resolution (reusing existing credentials configuration)
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

// Infrastructure configuration
const mediaConvertConfig = {
  region: (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.S3_REGION ||
    region ||
    'us-east-1'
  ).trim().replace(/^["']|["']$/g, ''),

  bucket: (
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET ||
    bucket ||
    'whitecoat-media-prod'
  ).trim().replace(/^["']|["']$/g, ''),

  roleArn: (
    process.env.MEDIACONVERT_ROLE_ARN ||
    'arn:aws:iam::951928130471:role/service-role/MediaConvert_Default_Role'
  ).trim().replace(/^["']|["']$/g, ''),

  cloudFrontDomain: (
    process.env.CLOUDFRONT_HLS_DOMAIN ||
    process.env.CLOUDFRONT_DOMAIN ||
    'd9rfsgqgwn1wa.cloudfront.net'
  ).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''),

  cloudFrontDistributionId: (
    process.env.CLOUDFRONT_DISTRIBUTION_ID ||
    'E2E9EGIGND5NDS'
  ).trim(),

  webhookSecret: (
    process.env.HLS_WEBHOOK_SECRET ||
    process.env.MEDIACONVERT_WEBHOOK_SECRET ||
    ''
  ).trim(),

  cloudFrontKeyPairId: (
    process.env.CLOUDFRONT_KEY_PAIR_ID ||
    process.env.CLOUDFRONT_PUBLIC_KEY_ID ||
    process.env.CLOUDFRONT_KEY_ID ||
    ''
  ).trim(),

  cloudFrontPrivateKey: (
    process.env.CLOUDFRONT_PRIVATE_KEY ||
    ''
  ).trim(),

  cookieDomain: (
    process.env.CLOUDFRONT_COOKIE_DOMAIN ||
    ''
  ).trim(),

  explicitEndpoint: (
    process.env.AWS_MEDIACONVERT_ENDPOINT ||
    ''
  ).trim(),
};

// Cached customer-specific MediaConvert endpoint URL
let cachedMediaConvertEndpoint = mediaConvertConfig.explicitEndpoint || null;

/**
 * Returns customer-specific MediaConvert endpoint URL (cached in memory).
 * Dynamically queries DescribeEndpoints if not explicitly set.
 */
async function getMediaConvertEndpoint() {
  if (cachedMediaConvertEndpoint) {
    return cachedMediaConvertEndpoint;
  }

  const baseConfig = { region: mediaConvertConfig.region };
  if (accessKeyId && secretAccessKey) {
    baseConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  const discoveryClient = new MediaConvertClient(baseConfig);
  try {
    const res = await discoveryClient.send(new DescribeEndpointsCommand({ MaxResults: 1 }));
    const endpoint = res.Endpoints?.[0]?.Url;
    if (endpoint) {
      cachedMediaConvertEndpoint = endpoint;
      console.info('[MediaConvert] Resolved customer endpoint:', endpoint);
      return endpoint;
    }
  } catch (err) {
    console.warn('[MediaConvert] DescribeEndpoints failed:', err.message);
  }

  return null;
}

/**
 * Creates and returns configured MediaConvertClient.
 */
async function getMediaConvertClient() {
  const endpoint = await getMediaConvertEndpoint();
  const clientConfig = {
    region: mediaConvertConfig.region,
    ...(endpoint ? { endpoint } : {}),
  };

  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  return new MediaConvertClient(clientConfig);
}

module.exports = {
  mediaConvertConfig,
  getMediaConvertEndpoint,
  getMediaConvertClient,
};

