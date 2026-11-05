const { getSignedCookies, getSignedUrl } = require('@aws-sdk/cloudfront-signer');
const { mediaConvertConfig } = require('../config/mediaconvert');

const DEFAULT_TTL_SECONDS = parseInt(process.env.S3_SIGNED_URL_EXPIRES_IN || '21600', 10); // 6 hours

/**
 * Resolves CloudFront Key Pair ID across supported environment variables and config fields.
 */
function getKeyPairId() {
  return (
    mediaConvertConfig.cloudFrontKeyPairId ||
    process.env.CLOUDFRONT_KEY_PAIR_ID ||
    process.env.CLOUDFRONT_PUBLIC_KEY_ID ||
    process.env.CLOUDFRONT_KEY_ID ||
    ''
  ).trim();
}

/**
 * Resolves raw private key from config or environment variables.
 */
function getPrivateKeyRaw() {
  return (
    mediaConvertConfig.cloudFrontPrivateKey ||
    process.env.CLOUDFRONT_PRIVATE_KEY ||
    ''
  ).trim();
}

/**
 * Resolves optional CloudFront cookie domain from config or environment variables.
 */
function getCookieDomain() {
  return (
    mediaConvertConfig.cookieDomain ||
    process.env.CLOUDFRONT_COOKIE_DOMAIN ||
    ''
  ).trim();
}

/**
 * Resolves CloudFront domain without protocol or trailing slash.
 */
function getCloudFrontDomain() {
  const domain = (
    mediaConvertConfig.cloudFrontDomain ||
    process.env.CLOUDFRONT_HLS_DOMAIN ||
    process.env.CLOUDFRONT_DOMAIN ||
    'd9rfsgqgwn1wa.cloudfront.net'
  ).trim();
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Checks if CloudFront key pair credentials are configured in the environment.
 */
function isCloudFrontSigningConfigured() {
  return Boolean(getKeyPairId() && getPrivateKeyRaw());
}

/**
 * Returns formatted private key string handling both raw PEM string and base64-encoded key.
 */
function getFormattedPrivateKey() {
  const rawKey = getPrivateKeyRaw();
  if (!rawKey) return '';
  if (rawKey.includes('-----BEGIN RSA PRIVATE KEY-----') || rawKey.includes('-----BEGIN PRIVATE KEY-----')) {
    return rawKey.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(rawKey, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) {
      return decoded.replace(/\\n/g, '\n');
    }
  } catch (_) {}
  return rawKey.replace(/\\n/g, '\n');
}

/**
 * Generates CloudFront signed cookies for HLS streaming (master playlist and all segments).
 * An explicit CloudFront custom policy with wildcard resource path ensures all .m3u8 playlists
 * and .ts segments under https://{domain}/hls/{videoId}/* are authorized.
 * Generates all three cookies: CloudFront-Policy, CloudFront-Signature, and CloudFront-Key-Pair-Id.
 */
function generateHlsSignedCookies(videoId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!videoId || !isCloudFrontSigningConfigured()) {
    return null;
  }

  const domain = getCloudFrontDomain();
  const privateKey = getFormattedPrivateKey();
  const keyPairId = getKeyPairId();
  const epochTime = Math.floor(Date.now() / 1000) + Number(ttlSeconds || DEFAULT_TTL_SECONDS);

  const policy = JSON.stringify({
    Statement: [
      {
        Resource: `https://${domain}/hls/${videoId}/*`,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': epochTime,
          },
        },
      },
    ],
  });

  try {
    const cookies = getSignedCookies({
      policy,
      keyPairId,
      privateKey,
    });
    return cookies;
  } catch (err) {
    console.warn('[CloudFront Signer] Failed to generate signed cookies:', err.message);
    return null;
  }
}

/**
 * Attaches CloudFront signed cookies to an Express response object.
 * Preserves HttpOnly, Secure, SameSite=None, Path=/, and applies optional Domain.
 */
function attachHlsCookiesToResponse(res, videoId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!res || typeof res.cookie !== 'function') {
    return false;
  }

  const cookies = generateHlsSignedCookies(videoId, ttlSeconds);
  if (!cookies) {
    return false;
  }

  const cookieDomain = getCookieDomain();
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: ttlSeconds * 1000,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
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

  return Boolean(
    cookies['CloudFront-Key-Pair-Id'] &&
    cookies['CloudFront-Policy'] &&
    cookies['CloudFront-Signature']
  );
}

/**
 * Generates a signed CloudFront URL for the master playlist if signed URL strategy is chosen.
 */
function generateHlsSignedUrl(masterUrl, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!isCloudFrontSigningConfigured() || !masterUrl) {
    return masterUrl;
  }

  const privateKey = getFormattedPrivateKey();
  const keyPairId = getKeyPairId();
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
  getFormattedPrivateKey,
  getKeyPairId,
  getCookieDomain,
  getCloudFrontDomain,
};
