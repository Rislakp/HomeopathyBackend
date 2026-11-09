const { getSignedCookies } = require('@aws-sdk/cloudfront-signer');
const { mediaConvertConfig } = require('../config/mediaconvert');

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 86400;
const MAX_COOKIE_VALUE_BYTES = 3500;
// CloudFront custom policies are limited to one day. Use the longest supported
// TTL by default; clients can renew by requesting their authorized access URL.
const DEFAULT_TTL_SECONDS = Number.parseInt(process.env.CLOUDFRONT_COOKIE_TTL || '86400', 10);

function getValidatedTtl(ttl = DEFAULT_TTL_SECONDS) {
  const value = Number(ttl);
  if (!Number.isInteger(value) || value < MIN_TTL_SECONDS || value > MAX_TTL_SECONDS) {
    throw new Error('Invalid CloudFront cookie TTL configuration');
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
    process.env.CLOUDFRONT_DOMAIN || ''
  ).trim();
  const normalized = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalized)) throw new Error('Invalid CloudFront media domain configuration');
  return normalized;
}

function getValidatedHlsMasterUrl(masterUrl, videoId) {
  const domain = getCloudFrontDomain();
  const id = String(videoId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid HLS video identifier');
  let parsed;
  try { parsed = new URL(String(masterUrl || '')); } catch (_) { throw new Error('Invalid HLS master playlist URL'); }
  const prefix = `/hls/${id}/`;
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== domain.toLowerCase() ||
      parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !parsed.pathname.startsWith(prefix) || !/\.m3u8$/i.test(parsed.pathname) ||
      parsed.pathname.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid HLS master playlist URL');
  }
  return `https://${domain}${parsed.pathname}`;
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
function normalizeVideoIds(videoIds) {
  const values = Array.isArray(videoIds) ? videoIds : [videoIds];
  const ids = [...new Set(values.map((id) => String(id || '').trim()))];
  if (!ids.length || ids.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) {
    throw new Error('Invalid HLS video identifier');
  }
  return ids;
}

function generateHlsSignedCookies(videoIds, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const ids = normalizeVideoIds(videoIds);
  if (!isCloudFrontSigningConfigured()) throw new Error('CloudFront signing is not configured');

  const domain = getCloudFrontDomain();
  ttlSeconds = getValidatedTtl(ttlSeconds);
  const privateKey = getFormattedPrivateKey();
  const keyPairId = getKeyPairId();
  const epochTime = Math.floor(Date.now() / 1000) + Number(ttlSeconds || DEFAULT_TTL_SECONDS);

  const policy = JSON.stringify({
    Statement: ids.map((videoId) => ({
        Resource: `https://${domain}/hls/${videoId}/*`,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': epochTime,
          },
        },
      })),
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
function attachHlsCookiesToResponse(res, videoId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!res || typeof res.cookie !== 'function') {
    return false;
  }

  const validatedTtl = getValidatedTtl(ttlSeconds);
  const cookieDomain = getCookieDomain();
  const normalizedCookieDomain = cookieDomain.replace(/^\./, '');
  if (!normalizedCookieDomain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalizedCookieDomain)) {
    throw new Error('CloudFront cookie domain is not configured or is invalid');
  }
  const cookies = generateHlsSignedCookies(videoId, validatedTtl);
  const names = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature'];
  if (names.some((name) => !cookies[name])) throw new Error('CloudFront signing failed');
  if (names.some((name) => Buffer.byteLength(cookies[name], 'utf8') > MAX_COOKIE_VALUE_BYTES)) {
    throw new Error('CloudFront signed-cookie policy exceeds browser cookie size limits');
  }

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    maxAge: validatedTtl * 1000,
    path: '/',
    domain: cookieDomain,
  };

  for (const name of names) res.cookie(name, cookies[name], cookieOptions);
  return true;
}

/**
 * HLS playlists reference child playlists and segments with relative URLs, so a
 * signed URL on the master playlist cannot authorize the complete stream.
 * HLS playback must use the signed-cookie architecture.
 */
function generateHlsSignedUrl() {
  throw new Error('HLS playback requires signed cookies to authorize playlists and segments');
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
  getValidatedHlsMasterUrl,
  getValidatedTtl,
};
