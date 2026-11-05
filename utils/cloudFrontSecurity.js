const { getSignedCookies, getSignedUrl } = require('@aws-sdk/cloudfront-signer');
const { mediaConvertConfig } = require('../config/mediaconvert');

const DEFAULT_TTL_SECONDS = parseInt(process.env.S3_SIGNED_URL_EXPIRES_IN || '21600', 10); // 6 hours

/**
 * Checks if CloudFront key pair credentials are configured in the environment.
 */
function isCloudFrontSigningConfigured() {
  return Boolean(
    mediaConvertConfig.cloudFrontKeyPairId &&
    mediaConvertConfig.cloudFrontPrivateKey
  );
}

/**
 * Returns formatted private key string handling both raw PEM string and base64-encoded key.
 */
function getFormattedPrivateKey() {
  const rawKey = mediaConvertConfig.cloudFrontPrivateKey || '';
  if (!rawKey) return '';
  if (rawKey.includes('-----BEGIN RSA PRIVATE KEY-----') || rawKey.includes('-----BEGIN PRIVATE KEY-----')) {
    return rawKey.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(rawKey, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) {
      return decoded;
    }
  } catch (_) {}
  return rawKey;
}

/**
 * Generates CloudFront signed cookies for HLS streaming (master playlist and all segments).
 * Wildcard resource path ensures all .m3u8 playlists and .ts segments under /hls/{videoId}/* are authorized.
 */
function generateHlsSignedCookies(videoId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!isCloudFrontSigningConfigured()) {
    return null;
  }

  const domain = mediaConvertConfig.cloudFrontDomain;
  const privateKey = getFormattedPrivateKey();
  const keyPairId = mediaConvertConfig.cloudFrontKeyPairId;
  const resourceUrl = `https://${domain}/hls/${videoId}/*`;
  const dateLessThan = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    const cookies = getSignedCookies({
      url: resourceUrl,
      keyPairId,
      privateKey,
      dateLessThan,
    });
    return cookies;
  } catch (err) {
    console.warn('[CloudFront Signer] Failed to generate signed cookies:', err.message);
    return null;
  }
}

/**
 * Attaches CloudFront signed cookies to an Express response object.
 */
function attachHlsCookiesToResponse(res, videoId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const cookies = generateHlsSignedCookies(videoId, ttlSeconds);
  if (!cookies || !res || typeof res.cookie !== 'function') {
    return false;
  }

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: ttlSeconds * 1000,
    path: '/',
  };

  if (cookies['CloudFront-Key-Pair-Id']) {
    res.cookie('CloudFront-Key-Pair-Id', cookies['CloudFront-Key-Pair-Id'], cookieOptions);
  }
  if (cookies['CloudFront-Policy']) {
    res.cookie('CloudFront-Policy', cookies['CloudFront-Policy'], cookieOptions);
  }
  if (cookies['CloudFront-Signature']) {
    res.cookie('CloudFront-Signature', cookies['CloudFront-Signature'], cookieOptions);
  }

  return true;
}

/**
 * Generates a signed CloudFront URL for the master playlist if signed URL strategy is chosen.
 */
function generateHlsSignedUrl(masterUrl, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!isCloudFrontSigningConfigured()) {
    return masterUrl;
  }

  const privateKey = getFormattedPrivateKey();
  const keyPairId = mediaConvertConfig.cloudFrontKeyPairId;
  const dateLessThan = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    return getSignedUrl({
      url: masterUrl,
      keyPairId,
      privateKey,
      dateLessThan,
    });
  } catch (err) {
    console.warn('[CloudFront Signer] Failed to generate signed URL:', err.message);
    return masterUrl;
  }
}

module.exports = {
  isCloudFrontSigningConfigured,
  generateHlsSignedCookies,
  attachHlsCookiesToResponse,
  generateHlsSignedUrl,
  DEFAULT_TTL_SECONDS,
};

