/**
 * Exam question images for the admin panel.
 *
 * The admin panel (Flutter web) loads images with XHR, which needs CORS headers
 * that CloudFront does not reliably send for the admin site. Students load the
 * same images through CloudFront without problems.
 *
 * So admin viewers get a link to this API instead, which already allows the admin
 * site in its CORS settings: /api/media/image?key=…&exp=…&sig=…
 * The link is signed (HMAC of key + expiry) and expires, like a CloudFront link.
 * Only image keys in image folders can be fetched.
 */
const crypto = require('crypto');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');
const { normalizeS3Reference, resolveProfileImageUrl, CLOUDFRONT_IMAGE_FOLDERS } = require('./s3MediaSigner');
const { imageKeyFromPath } = require('../middleware/uploadsS3ImageRedirect');

const LINK_TTL_SECONDS = 12 * 60 * 60;
const proxySecret = () => process.env.MEDIA_PROXY_SECRET || process.env.JWT_SECRET || '';
const apiBase = () => (process.env.API_PUBLIC_URL || 'https://api.whitecoat.academy').replace(/\/+$/, '');

const sign = (key, exp) => crypto
  .createHmac('sha256', proxySecret())
  .update(`${key}:${exp}`)
  .digest('base64url');

function buildImageProxyUrl(key, { now = Date.now() } = {}) {
  if (!proxySecret() || !imageKeyFromPath(`/${key}`)) return '';
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  return `${apiBase()}/api/media/image?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
}

function verifyImageProxy(key, exp, sig, { now = Date.now() } = {}) {
  if (!proxySecret() || typeof key !== 'string' || typeof sig !== 'string') return false;
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum * 1000 < now) return false;
  const expected = Buffer.from(sign(key, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const isStudentViewer = (user) => String(user?.role || '').toLowerCase().trim() === 'student';

/**
 * Signed link for a stored question image, chosen for the viewer:
 * students get CloudFront, everyone else (admin panel) gets the API proxy.
 */
const hasCloudFrontBehavior = (key) => CLOUDFRONT_IMAGE_FOLDERS.some((folder) => key.startsWith(`${folder}/`));

async function signImageForViewer(rawImage, user) {
  if (typeof rawImage !== 'string' || !rawImage.trim()) return rawImage;
  const raw = rawImage.trim();
  const key = normalizeS3Reference(raw)?.s3Key;
  // Admin panel: always the proxy (CORS). Students: the proxy only for folders
  // CloudFront does not serve, so those images still load.
  if (key && ((user && !isStudentViewer(user)) || !hasCloudFrontBehavior(key))) {
    const proxied = buildImageProxyUrl(key);
    if (proxied) return proxied;
  }
  return resolveProfileImageUrl(raw);
}

async function imageProxyHandler(req, res) {
  const { key, exp, sig } = req.query || {};
  const match = typeof key === 'string' ? imageKeyFromPath(`/${key}`) : null;
  if (!match || !verifyImageProxy(match.key, exp, sig)) {
    return res.status(403).json({ success: false, message: 'Invalid or expired image link.' });
  }
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: match.key }));
    res.setHeader('Content-Type', object.ContentType || match.contentType);
    if (object.ContentLength) res.setHeader('Content-Length', String(object.ContentLength));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (typeof object.Body?.pipe === 'function') return object.Body.pipe(res);
    const bytes = await object.Body.transformToByteArray();
    return res.end(Buffer.from(bytes));
  } catch (err) {
    const status = err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404 ? 404 : 502;
    return res.status(status).json({ success: false, message: 'Image not available.' });
  }
}

module.exports = {
  buildImageProxyUrl,
  verifyImageProxy,
  signImageForViewer,
  imageProxyHandler,
  LINK_TTL_SECONDS,
};
