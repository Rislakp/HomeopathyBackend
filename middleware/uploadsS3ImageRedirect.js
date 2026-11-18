/**
 * Some screens build image links as https://api.whitecoat.academy/uploads/<s3 key>,
 * as if the image were stored on this server. The file is in S3, so that link
 * used to return 404 (admin preview and student view).
 *
 * This runs after the local /uploads static files: when no local file matched and
 * the path is an S3 image key, serve the image from S3.
 * Only image files are redirected (no videos or documents), from any folder.
 * Keys contain a random UUID, so a link only works for someone who already has it.
 */
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');
const { isSafeImageKey } = require('../utils/s3MediaSigner');

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
  // Served directly instead of redirecting to CloudFront: browsers load these
  // images with XHR (Flutter web), and after a cross-site redirect the request
  // has Origin "null", which CloudFront refuses (CORS error). This response gets
  // the API's own CORS headers.
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: match.key }));
    res.setHeader('Content-Type', object.ContentType || match.contentType);
    if (object.ContentLength) res.setHeader('Content-Length', String(object.ContentLength));
    // Keys contain a timestamp and a random UUID, so the content never changes.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.method === 'HEAD') return res.end();
    if (typeof object.Body?.pipe === 'function') return object.Body.pipe(res);
    return res.end(Buffer.from(await object.Body.transformToByteArray()));
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return next();
    return res.status(502).json({ success: false, message: 'Image not available.' });
  }
}

module.exports = { uploadsS3ImageRedirect, imageKeyFromPath };
