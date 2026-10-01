/**
 * DocumentViewerUtils (JavaScript / Web helper)
 * Normalizes Cloudinary document/PDF URLs and handles fallback launches.
 */

function sanitizeDocumentUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed.includes('cloudinary.com')) return trimmed;

  let sanitized = trimmed;
  if (sanitized.includes('/raw/upload/')) {
    if (!sanitized.includes('/fl_attachment/') && !sanitized.includes('/fl_attachment')) {
      sanitized = sanitized.replace('/raw/upload/', '/raw/upload/fl_attachment/');
    }
  }
  return sanitized;
}

function convertRawToImageDelivery(url) {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return url || '';
  return url.replace('/raw/upload/', '/image/upload/');
}

function openInNewWindow(url, target = '_blank') {
  const sanitized = sanitizeDocumentUrl(url);
  if (typeof window !== 'undefined' && window.open) {
    window.open(sanitized, target);
  }
}

function handleViewerErrorOrFallback(error, originalUrl, onFallbackTriggered) {
  console.warn('[DocumentViewerUtils] Embedded preview failed:', error);
  const sanitized = sanitizeDocumentUrl(originalUrl);
  if (typeof onFallbackTriggered === 'function') {
    onFallbackTriggered('Launching document in native viewer...');
  }
  openInNewWindow(sanitized, '_blank');
}

module.exports = {
  sanitizeDocumentUrl,
  convertRawToImageDelivery,
  openInNewWindow,
  handleViewerErrorOrFallback,
};
