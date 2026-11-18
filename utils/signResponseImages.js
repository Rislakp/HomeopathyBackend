/**
 * Response middleware: signs every stored image link in a JSON response.
 *
 * Images are stored in a private bucket, as S3 keys or raw links, by many screens
 * and in many folders. Returned as-is they are refused (403), so images don't show
 * in the admin panel, the student site or the Unani site.
 *
 * Mounted on the whole API, this walks the response body and replaces stored image
 * links with a fresh signed link for the viewer (see utils/mediaImageProxy.js):
 * - any string that links to one of our image files (bucket, legacy bucket,
 *   CloudFront or /uploads link), whatever the field is called or the folder;
 * - a bare S3 key in an image field (imageUrl, image, ...).
 * Videos, documents and links that aren't ours are left unchanged, so this needs
 * no update when a screen uploads images into a new folder.
 */
const { signImageForViewer } = require('./mediaImageProxy');
const { normalizeS3Reference, isSafeImageKey, canonicalS3Url } = require('./s3MediaSigner');

const IMAGE_FIELDS = new Set([
  'imageUrl', 'image', 'questionImage', 'imgUrl', 'profileImage', 'avatar',
  'optionImage', 'explanationImage', 'thumbnail', 'thumbnailUrl', 'bannerImage', 'photo', 'photoUrl',
]);
const MAX_DEPTH = 14;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:[?#&]|$)/i;
// Signed links (proxy, CloudFront, S3) are signed again too: a signed link that
// was saved into the database expires, and the admin panel needs the proxy.

/** Returns the S3 key if `value` is a stored link to one of our image files. */
// Presigned *upload* links (the browser PUTs the file to them): never images to show.
const UPLOAD_LINK_RE = /[?&]x-id=(PutObject|UploadPart|CreateMultipartUpload|CompleteMultipartUpload)\b/i;
const UPLOAD_FIELDS = new Set(['uploadUrl', 'presignedUrl', 'presigned_url', 'putUrl', 'signedUploadUrl', 'uploadURL']);
// Upload/presign endpoints return links the client must use exactly as given.
const SKIP_PATH_RE = /^\/(api\/)?(v1\/)?(s3|s3-upload)(\/|$)|presign|multipart/i;

function storedImageKey(value, isImageField) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > 2048 || !IMAGE_EXT_RE.test(raw)) return '';
  if (UPLOAD_LINK_RE.test(raw)) return '';
  const isLink = /^https:\/\//i.test(raw) || raw.startsWith('/uploads/');
  // A bare key ("folder/file.png") only counts in an image field.
  if (!isLink && !isImageField) return '';
  const key = normalizeS3Reference(raw)?.s3Key || '';
  return isSafeImageKey(key) ? key : '';
}

async function signImagesDeep(value, viewer, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => (typeof item === 'string'
      ? signString(item, viewer, false)
      : signImagesDeep(item, viewer, depth + 1))));
  }
  const out = {};
  await Promise.all(Object.keys(value).map(async (key) => {
    const field = value[key];
    out[key] = typeof field === 'string'
      ? (UPLOAD_FIELDS.has(key) ? field : await signString(field, viewer, IMAGE_FIELDS.has(key)))
      : await signImagesDeep(field, viewer, depth + 1);
  }));
  return out;
}

async function signString(value, viewer, isImageField) {
  if (!storedImageKey(value, isImageField)) return value;
  try {
    return await signImageForViewer(value.trim(), viewer);
  } catch (_) {
    return value;
  }
}

function signResponseImages(req, res, next) {
  if (SKIP_PATH_RE.test(String(req.originalUrl || req.url || '').split('?')[0])) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (!body || typeof body !== 'object' || res.statusCode >= 400) return originalJson(body);
    let plain;
    try {
      plain = JSON.parse(JSON.stringify(body)); // same shape the client would receive
    } catch (_) {
      return originalJson(body);
    }
    signImagesDeep(plain, req.user)
      .then((signed) => originalJson(signed))
      .catch(() => originalJson(body));
    return res;
  };
  next();
}

/**
 * Request middleware: the admin panel shows the signed links it received and
 * sends them back when a form is saved. Signed links expire (the proxy after
 * 12 hours), so before anything is stored, every link to one of our images in
 * the request body is replaced by its permanent link. Bare keys and links that
 * aren't ours are left as they are.
 */
function normalizeImageLinksDeep(value, depth = 0) {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!/^https:\/\//i.test(raw)) return value;
    const key = storedImageKey(raw, false);
    return key ? canonicalS3Url(key) : value;
  }
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeImageLinksDeep(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (!UPLOAD_FIELDS.has(key)) value[key] = normalizeImageLinksDeep(value[key], depth + 1);
  }
  return value;
}

function normalizeRequestImageLinks(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object' &&
      !SKIP_PATH_RE.test(String(req.originalUrl || req.url || '').split('?')[0])) {
    try { normalizeImageLinksDeep(req.body); } catch (_) { /* leave the body as sent */ }
  }
  next();
}

module.exports = {
  signResponseImages,
  signImagesDeep,
  storedImageKey,
  normalizeRequestImageLinks,
  normalizeImageLinksDeep,
  IMAGE_FIELDS,
};
