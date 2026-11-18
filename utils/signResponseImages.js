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
const { normalizeS3Reference, isSafeImageKey } = require('./s3MediaSigner');

const IMAGE_FIELDS = new Set([
  'imageUrl', 'image', 'questionImage', 'imgUrl', 'profileImage', 'avatar',
  'optionImage', 'explanationImage', 'thumbnail', 'thumbnailUrl', 'bannerImage', 'photo', 'photoUrl',
]);
const MAX_DEPTH = 14;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i;
// Links we produce ourselves; signing them again would only add work.
const ALREADY_SIGNED_RE = /[?&](X-Amz-Signature|Signature|sig)=/;

/** Returns the S3 key if `value` is a stored link to one of our image files. */
function storedImageKey(value, isImageField) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > 2048 || !IMAGE_EXT_RE.test(raw)) return '';
  const isLink = /^https:\/\//i.test(raw) || raw.startsWith('/uploads/');
  // A bare key ("folder/file.png") only counts in an image field.
  if (!isLink && !isImageField) return '';
  if (isLink && ALREADY_SIGNED_RE.test(raw)) return '';
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
      ? await signString(field, viewer, IMAGE_FIELDS.has(key))
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

module.exports = { signResponseImages, signImagesDeep, storedImageKey, IMAGE_FIELDS };
