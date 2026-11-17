/**
 * Response middleware: signs every stored image link in a JSON response.
 *
 * Unani exams, ranks and reviews store images as S3 keys or raw links and return
 * them as-is, so the private bucket refuses them (images don't show in the admin
 * panel or on the Unani site). Mounted in front of those routes, this walks the
 * response body and replaces image fields with a signed link for the viewer:
 * students/public get CloudFront links, the admin panel gets the API proxy link
 * (see utils/mediaImageProxy.js). Links that aren't ours are left unchanged.
 */
const { signImageForViewer } = require('./mediaImageProxy');

const IMAGE_FIELDS = new Set(['imageUrl', 'image', 'questionImage', 'imgUrl', 'profileImage', 'avatar']);
const MAX_DEPTH = 12;

async function signImagesDeep(value, viewer, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => signImagesDeep(item, viewer, depth + 1)));
  }
  const out = {};
  await Promise.all(Object.keys(value).map(async (key) => {
    const field = value[key];
    if (IMAGE_FIELDS.has(key) && typeof field === 'string' && field.trim()) {
      try {
        out[key] = await signImageForViewer(field.trim(), viewer);
      } catch (_) {
        out[key] = field;
      }
    } else {
      out[key] = await signImagesDeep(field, viewer, depth + 1);
    }
  }));
  return out;
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

module.exports = { signResponseImages, signImagesDeep, IMAGE_FIELDS };
