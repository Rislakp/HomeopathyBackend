const { getSignedUrl } = require('@aws-sdk/cloudfront-signer');

const DEFAULT_CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';

/**
 * Resolves CloudFront Key Pair ID across supported environment variables and config fields.
 */
function getKeyPairId() {
  return (
    process.env.CLOUDFRONT_KEY_PAIR_ID ||
    process.env.CLOUDFRONT_PUBLIC_KEY_ID ||
    process.env.CLOUDFRONT_KEY_ID ||
    ''
  ).trim();
}

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
  const rawKey = (process.env.CLOUDFRONT_PRIVATE_KEY || '').trim();
  return rawKey.replace(/\\n/g, '\n').trim();
}

/**
 * Returns the normalized CloudFront distribution or custom domain.
 * Respects explicit environment variables (CLOUDFRONT_DOMAIN, CLOUDFRONT_HLS_DOMAIN)
 * and mediaConvertConfig before falling back to media.whitecoat.academy.
 */
function getCloudFrontDomain() {
  let domain = (
    process.env.CLOUDFRONT_DOMAIN ||
    process.env.CLOUDFRONT_HLS_DOMAIN ||
    ''
  ).trim();

  if (domain === 'undefined' || domain === 'null') domain = '';

  if (!domain) {
    try {
      const { mediaConvertConfig } = require('../config/mediaconvert');
      domain = (mediaConvertConfig?.cloudFrontDomain || '').trim();
    } catch (_) {}
  }

  if (domain === 'undefined' || domain === 'null') domain = '';

  domain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return domain || DEFAULT_CLOUDFRONT_DOMAIN;
}

/**
 * Checks whether a given hostname is a trusted CloudFront domain.
 */
function isCloudFrontDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.trim().toLowerCase();
  const configured = getCloudFrontDomain().toLowerCase();
  return lower === configured ||
    lower.endsWith(`.${configured}`) ||
    lower === 'media.whitecoat.academy' ||
    lower.endsWith('.media.whitecoat.academy') ||
    lower === 'cloudfront.net' ||
    lower.endsWith('.cloudfront.net');
}

/**
 * Checks whether a given hostname is an AWS S3 host.
 */
function isS3Host(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.trim().toLowerCase();
  return lower.endsWith('.amazonaws.com') &&
    (lower.includes('.s3.') || lower.startsWith('s3.') || lower.includes('s3-'));
}

/**
 * Checks whether CloudFront signing credentials (domain, key pair ID, RSA private key) are available.
 */
function isCloudFrontSigningConfigured() {
  const domain = getCloudFrontDomain();
  const keyPairId = getKeyPairId();
  const privateKey = getPrivateKey();

  return Boolean(domain && keyPairId && privateKey);
}

/**
 * Evaluates whether CloudFront playback signing is active and properly configured.
 * Default is FALSE unless CLOUDFRONT_ENABLED is explicitly 'true' with all credentials,
 * or signing credentials are present and CLOUDFRONT_ENABLED is not set to 'false'.
 */
function isCloudFrontConfigured() {
  const enabledStr = (process.env.CLOUDFRONT_ENABLED || '').toString().trim().toLowerCase();
  if (enabledStr === 'false') return false;
  if (enabledStr === 'true') {
    return isCloudFrontSigningConfigured();
  }
  return isCloudFrontSigningConfigured();
}

/**
 * Safely extracts the clean S3 key from either a URL or raw key string.
 */
function extractS3Key(keyOrUrl) {
  if (!keyOrUrl || typeof keyOrUrl !== 'string') return '';
  const trimmed = keyOrUrl.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (isCloudFrontDomain(host)) {
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      }
      if (isS3Host(host)) {
        const bucket = (process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'whitecoat-media-prod').trim().toLowerCase();
        let pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        if (host.startsWith('s3.') || host.includes('s3-')) {
          const segments = pathname.split('/');
          if (segments[0].toLowerCase() === bucket) {
            pathname = segments.slice(1).join('/');
          }
        }
        return pathname;
      }
      // Cloudinary or other third-party host
      return '';
    } catch (_) {
      return '';
    }
  }

  // Raw key: safely strip any query parameters or hash fragments
  return trimmed.split('?')[0].split('#')[0].replace(/^\/+/, '');
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

  const keyPairId = getKeyPairId();
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

/**
 * Resolves any S3 key or legacy S3 URL to a consistent CloudFront playback URL.
 * Guarantees:
 * - Existing CloudFront URLs are preserved (no alteration, no double-prefixing).
 * - External URLs (e.g. Cloudinary) are preserved as-is.
 * - S3 keys and direct S3 URLs are safely routed to https://media.whitecoat.academy/<key>.
 * - If CloudFront signing credentials are configured, signs the URL with canned policy.
 * - If signing credentials are not configured, returns the CloudFront URL (relying on signed cookies).
 * - Never returns a direct s3.amazonaws.com URL.
 *
 * @param {string} s3KeyOrUrl - S3 key or URL
 * @param {object} [options] - Signing options (e.g. expiresIn)
 * @returns {string} CloudFront playback URL
 */
function resolveCloudFrontPlaybackUrl(s3KeyOrUrl, options = {}) {
  if (!s3KeyOrUrl || typeof s3KeyOrUrl !== 'string') return '';
  const trimmed = s3KeyOrUrl.trim();
  if (!trimmed) return '';

  // 1. If it's already a CloudFront URL, keep it unchanged (preserves signed query params)
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (isCloudFrontDomain(parsed.hostname)) {
        return trimmed;
      }
      // 2. If it's Cloudinary or other external host, keep it unchanged
      if (parsed.hostname.includes('cloudinary.com')) {
        return trimmed;
      }
    } catch (_) {}
  }

  // 3. Extract the clean S3 key
  const cleanKey = extractS3Key(trimmed);
  if (!cleanKey) {
    return trimmed;
  }

  // Double-prefix guard
  const normalizedKey = cleanKey
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^media\.whitecoat\.academy\//i, '')
    .replace(/^\/+/, '');

  const domain = getCloudFrontDomain();

  // 4. If CloudFront signing is configured, attempt signing
  if (isCloudFrontSigningConfigured()) {
    try {
      return signCloudFrontPlaybackUrl(normalizedKey, options);
    } catch (cfErr) {
      console.warn('[CloudFront Signer] URL signing failed; returning CloudFront base URL with signed cookies:', cfErr.message);
    }
  }

  // 5. Default CloudFront media delivery URL (CloudFront signed cookies provide auth)
  return `https://${domain}/${normalizedKey}`;
}

module.exports = {
  isCloudFrontConfigured,
  isCloudFrontSigningConfigured,
  signCloudFrontPlaybackUrl,
  resolveCloudFrontPlaybackUrl,
  mapS3UrlToCloudFront: resolveCloudFrontPlaybackUrl,
  getCloudFrontDomain,
  getPrivateKey,
  getKeyPairId,
  isCloudFrontDomain,
  isS3Host,
  extractS3Key,
};


