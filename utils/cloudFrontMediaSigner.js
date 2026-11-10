const { getSignedUrl } = require('@aws-sdk/cloudfront-signer');

/**
 * Extracts and normalizes the RSA private key from environment variables.
 * Supports standard PEM string (with \n) or base64-encoded PEM string.
 */
function getPrivateKey() {
  if (process.env.CLOUDFRONT_PRIVATE_KEY_BASE64) {
    try {
      return Buffer.from(process.env.CLOUDFRONT_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
    } catch (_) {
      return '';
    }
  }
  const rawKey = process.env.CLOUDFRONT_PRIVATE_KEY || '';
  return rawKey.replace(/\\n/g, '\n').trim();
}

/**
 * Returns the normalized CloudFront distribution or custom domain.
 */
function getCloudFrontDomain() {
  return (process.env.CLOUDFRONT_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * Evaluates whether CloudFront playback signing is active and properly configured.
 * Default is FALSE unless CLOUDFRONT_ENABLED is explicitly 'true' with all credentials.
 */
function isCloudFrontConfigured() {
  const enabled = (process.env.CLOUDFRONT_ENABLED || '').toString().trim().toLowerCase() === 'true';
  if (!enabled) return false;

  const domain = getCloudFrontDomain();
  const keyPairId = (process.env.CLOUDFRONT_KEY_PAIR_ID || '').trim();
  const privateKey = getPrivateKey();

  return Boolean(domain && keyPairId && privateKey);
}

/**
 * Signs a media asset path using AWS CloudFront Canned Policy.
 *
 * @param {string} s3Key - S3 asset key (e.g. 'videos/lecture.mp4')
 * @param {object} [options]
 * @param {number} [options.expiresIn] - Expiration duration in seconds (defaults to env or 6 hours)
 * @returns {string} Fully qualified CloudFront signed URL
 */
function signCloudFrontPlaybackUrl(s3Key, options = {}) {
  if (!s3Key || typeof s3Key !== 'string') {
    throw new Error('s3Key is required for CloudFront signing');
  }

  const domain = getCloudFrontDomain();
  if (!domain) {
    throw new Error('CLOUDFRONT_DOMAIN is not configured');
  }

  const keyPairId = (process.env.CLOUDFRONT_KEY_PAIR_ID || '').trim();
  if (!keyPairId) {
    throw new Error('CLOUDFRONT_KEY_PAIR_ID is not configured');
  }

  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error('CLOUDFRONT_PRIVATE_KEY is not configured or invalid');
  }

  const cleanKey = s3Key.replace(/^\/+/, '');
  const url = `https://${domain}/${cleanKey}`;
  const ttlSeconds = options.expiresIn ||
    parseInt(process.env.CLOUDFRONT_SIGNED_URL_TTL_SECONDS, 10) ||
    parseInt(process.env.S3_SIGNED_URL_EXPIRES_IN || process.env.S3_MEDIA_URL_TTL_SECONDS, 10) ||
    21600;

  const dateLessThan = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return getSignedUrl({
    url,
    keyPairId,
    privateKey,
    dateLessThan,
  });
}

module.exports = {
  isCloudFrontConfigured,
  signCloudFrontPlaybackUrl,
  getCloudFrontDomain,
  getPrivateKey,
};

