/**
 * Some screens build image links as https://api.whitecoat.academy/uploads/<s3 key>,
 * as if the image were stored on this server. The file is in S3, so that link
 * used to return 404 (admin preview and student view).
 *
 * This runs after the local /uploads static files: when no local file matched and
 * the path is an S3 image key, redirect to a fresh signed CloudFront link.
 * Only image files are redirected (no videos or documents), from any folder.
 * Keys contain a random UUID, so a link only works for someone who already has it.
 */
const { signS3Reference, isSafeImageKey } = require('../utils/s3MediaSigner');

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function imageKeyFromPath(reqPath) {
  let key;
  try {
    key = decodeURIComponent(String(reqPath || '')).replace(/^\/+/, '');
  } catch (_) {
    return null;
  }
  // Any image in the bucket, whatever its folder; never videos or documents.
  if (!isSafeImageKey(key)) return null;
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  return IMAGE_TYPES[ext] ? { key, contentType: IMAGE_TYPES[ext] } : null;
}

async function uploadsS3ImageRedirect(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const match = imageKeyFromPath(req.path);
  if (!match) return next();
  try {
    const signed = await signS3Reference({ storageProvider: 's3', s3Key: match.key }, match.contentType);
    if (!signed?.url) return next();
    // Signed links expire, so never cache the redirect itself.
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, signed.url);
  } catch (_) {
    return next();
  }
}

module.exports = { uploadsS3ImageRedirect, imageKeyFromPath };
