const { getSignedCookies, getSignedUrl } = require('@aws-sdk/cloudfront-signer');
const { mediaConvertConfig } = require('../config/mediaconvert');

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 86400;
// Default to 6 hours (21600s) to fully support long classes (> 2 hours) and scrubbing/seeking without session drops
const DEFAULT_TTL_SECONDS = Number.parseInt(
  process.env.CLOUDFRONT_COOKIE_TTL ||
  process.env.S3_SIGNED_URL_EXPIRES_IN ||
  '21600',
  10
);

function getValidatedTtl(ttl = DEFAULT_TTL_SECONDS) {
  const value = Number(ttl || DEFAULT_TTL_SECONDS);
  if (!Number.isInteger(value) || value < MIN_TTL_SECONDS || value > MAX_TTL_SECONDS) {
    return DEFAULT_TTL_SECONDS;
  }
  return value;
}

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
  const domain = (
    mediaConvertConfig.cookieDomain ||
    process.env.CLOUDFRONT_COOKIE_DOMAIN ||
    ''
  ).trim().replace(/^["']|["']$/g, '');
  return domain;
}

/**
 * Resolves CloudFront domain without protocol or trailing slash.
 */
function getCloudFrontDomain() {
  const domain = (
    mediaConvertConfig.cloudFrontDomain ||
    process.env.CLOUDFRONT_HLS_DOMAIN ||
    process.env.CLOUDFRONT_DOMAIN ||
    'media.whitecoat.academy'
  ).trim();
  const normalized = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalized)) {
    return 'media.whitecoat.academy';
  }
  return normalized;
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
 * Normalizes/aligns a persisted HLS master playlist URL with the configured CloudFront domain,
 * strictly preserving the persisted playlist filename, directory structure, and query params.
 */
function resolvePersistedHlsUrl(persistedUrl, videoId) {
  const domain = getCloudFrontDomain();
  const rawUrl = String(persistedUrl || '').trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return `https://${domain}${parsed.pathname}${parsed.search || ''}`;
    } catch (_) {
      if (rawUrl.startsWith('/')) {
        return `https://${domain}${rawUrl}`;
      }
      return rawUrl;
    }
  }
  const cleanVid = encodeURIComponent(String(videoId || '').trim());
  return `https://${domain}/hls/${cleanVid}/${cleanVid}.m3u8`;
}

/**
 * Generates CloudFront signed cookies for HLS streaming (master playlist, variant playlists, and all segments).
 * An explicit CloudFront custom policy with wildcard resource path ensures all .m3u8 playlists
 * and .ts segments under https://{domain}/{prefix}/* are authorized.
 * Generates all three cookies: CloudFront-Policy, CloudFront-Signature, and CloudFront-Key-Pair-Id.
 */
function generateHlsSignedCookies(videoId, ttlSeconds = DEFAULT_TTL_SECONDS, customPrefix = null) {
  if (!videoId || !/^[A-Za-z0-9_.-]+$/.test(String(videoId))) {
    throw new Error('Invalid HLS video identifier');
  }
  if (!isCloudFrontSigningConfigured()) {
    throw new Error('CloudFront signing is not configured');
  }

  const domain = getCloudFrontDomain();
  ttlSeconds = getValidatedTtl(ttlSeconds);
  const privateKey = getFormattedPrivateKey();
  const keyPairId = getKeyPairId();
  const epochTime = Math.floor(Date.now() / 1000) + Number(ttlSeconds || DEFAULT_TTL_SECONDS);

  let resourcePattern;
  if (customPrefix && typeof customPrefix === 'string' && customPrefix.trim()) {
    const cleanPrefix = customPrefix.trim().replace(/^\/+/, '').replace(/\/*$/, '/*');
    resourcePattern = `https://${domain}/${cleanPrefix}`;
  } else {
    resourcePattern = `https://${domain}/hls/${videoId}/*`;
  }

  const policy = JSON.stringify({
    Statement: [
      {
        Resource: resourcePattern,
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
    throw new Error('CloudFront signing failed');
  }
}

/**
 * Attaches CloudFront signed cookies to an Express response object.
 * Preserves HttpOnly, Secure, SameSite=None, Path=/, and applies optional Domain.
 */
function attachHlsCookiesToResponse(res, videoId, ttlSeconds = DEFAULT_TTL_SECONDS, customPrefix = null) {
  if (!res || typeof res.cookie !== 'function') {
    return false;
  }

  const cookies = generateHlsSignedCookies(videoId, ttlSeconds, customPrefix);

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
  getValidatedTtl,
  resolvePersistedHlsUrl,
};
