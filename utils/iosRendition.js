/**
 * Helpers for the iOS seek-safe rendition of a video.
 *
 * New renditions are saved as `<original>_ios.mp4`. Older ones were saved as
 * `<original>_ios.m4v`; both are still accepted.
 */
const IOS_RENDITION_SUFFIX = '_ios.mp4';
const IOS_RENDITION_RE = /_ios\.(mp4|m4v)$/i;

function isIosRenditionKey(key) {
  return typeof key === 'string' && IOS_RENDITION_RE.test(key.trim());
}

// Possible original keys for a rendition key, e.g. `a_ios.mp4` -> `a.mp4`, `a.webm`, `a.mov`.
function getOriginalKeyCandidates(renditionKey) {
  if (!isIosRenditionKey(renditionKey)) return [];
  const base = renditionKey.trim().replace(IOS_RENDITION_RE, '');
  return [`${base}.mp4`, `${base}.webm`, `${base}.mov`];
}

module.exports = {
  IOS_RENDITION_SUFFIX,
  IOS_RENDITION_RE,
  isIosRenditionKey,
  getOriginalKeyCandidates,
};
