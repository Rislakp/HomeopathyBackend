const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket, region, publicBaseUrl } = require('../config/s3');

// Time-to-live for signed URLs (in seconds)
const S3_MEDIA_URL_TTL_SECONDS = 900;

// Allowed S3 key patterns (folders and safe characters)
const SAFE_S3_KEY = /^(videos|images|pdfs|documents|attachments|reviews|unani_ranks|grand_mock_questions|live_records)\/[a-zA-Z0-9][a-zA-Z0-9._\/\-]*$/;

/**
 * Remove all URL fields from a reference object, effectively stripping signed data.
 */
const stripS3ReferenceUrls = (reference) => ({
  ...reference,
  fileName: reference.fileName || reference.originalFileName || '',
  url: '',
  secure_url: '',
  secureUrl: '',
  fileUrl: '',
  documentUrl: '',
  path: '',
  videoUrl: '',
  mediaUrl: '',
});

/**
 * Normalise a raw reference (string or object) into a standard shape containing an S3 key.
 */
const normalizeS3Reference = (reference) => {
  const source = typeof reference === 'string' ? { url: reference } : reference;
  if (!source || typeof source !== 'object') return null;
  if (source.storageProvider === 's3' && typeof source.s3Key === 'string' && source.s3Key) return source;

  const rawUrl = source.url || source.secure_url || source.secureUrl || source.fileUrl || source.path || source.videoUrl || source.mediaUrl || source.s3Key;
  if (typeof rawUrl !== 'string') return null;

  // Direct S3 key style reference (already safe)
  if (SAFE_S3_KEY.test(rawUrl) && !rawUrl.includes('..') && !rawUrl.includes('//') && !/[\r\n]/.test(rawUrl)) {
    return { ...source, storageProvider: 's3', s3Key: rawUrl, url: '', secure_url: '', secureUrl: '', fileUrl: '', documentUrl: '', path: '', videoUrl: '', mediaUrl: '' };
  }

  // Must be a full HTTPS URL pointing to our bucket (or a custom public base URL)
  if (!/^https:\/\//i.test(rawUrl)) return null;
  try {
    const parsed = new URL(rawUrl);
    let keyPath = '';
    const expectedHosts = new Set([
      `${bucket}.s3.${region}.amazonaws.com`,
      `${bucket}.s3.amazonaws.com`,
    ]);
    if (publicBaseUrl) {
      try { expectedHosts.add(new URL(publicBaseUrl).hostname); } catch (_) { /* ignore invalid base URL */ }
    }
    if (parsed.hostname.includes('amazonaws.com') && !expectedHosts.has(parsed.hostname)) {
      expectedHosts.add(parsed.hostname);
    }
    if (!expectedHosts.has(parsed.hostname)) return null;

    let pathParts = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (parsed.hostname.startsWith('s3.') || parsed.hostname.startsWith('s3-')) {
      const segments = pathParts.split('/');
      if (segments[0] === bucket) {
        pathParts = segments.slice(1).join('/');
      }
    }
    keyPath = pathParts;
    if (!SAFE_S3_KEY.test(keyPath) || keyPath.includes('..') || keyPath.includes('//') || /[\r\n]/.test(keyPath)) return null;
    return { ...source, storageProvider: 's3', s3Key: keyPath, url: '', secure_url: '', secureUrl: '', fileUrl: '', documentUrl: '', path: '', videoUrl: '', mediaUrl: '' };
  } catch (_) {
    return null;
  }
};

/**
 * Generate a presigned GET URL for an S3 object and safely encode '+' characters.
 */
const signS3Reference = async (reference, responseContentType) => {
  if (!reference || reference.storageProvider !== 's3') return reference;

  const key = typeof reference.s3Key === 'string' ? reference.s3Key : '';
  const validKey = SAFE_S3_KEY.test(key) && !key.includes('..') && !key.includes('//') && !/[\r\n]/.test(key);
  if (!validKey) {
    return stripS3ReferenceUrls(reference);
  }

  try {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(responseContentType ? { ResponseContentType: responseContentType, ResponseContentDisposition: 'inline' } : {}),
      }),
      { expiresIn: S3_MEDIA_URL_TTL_SECONDS }
    );
        const encodedUrl = encodeSignedUrl(url);
        return {
          ...reference,
          fileName: reference.fileName || reference.originalFileName || '',
          url: encodedUrl,
          secure_url: encodedUrl,
          secureUrl: encodedUrl,
          fileUrl: encodedUrl,
          documentUrl: encodedUrl,
          path: encodedUrl,
          videoUrl: encodedUrl,
          mediaUrl: encodedUrl,
          accessUrlExpiresIn: S3_MEDIA_URL_TTL_SECONDS,
        };
  } catch (err) {
    console.error('[S3 media signer] Failed to sign media reference:', {
      key,
      code: err.name || err.Code,
      message: err.message,
    });
    return stripS3ReferenceUrls(reference);
  }
};

/**
 * Resolve a profile image reference (string or object) to a signed URL.
 */
const resolveProfileImageUrl = async (rawImage) => {
  if (!rawImage || typeof rawImage !== 'string') return rawImage;
  const s3Ref = normalizeS3Reference(rawImage);
  if (!s3Ref) return rawImage;
  const key = (s3Ref.s3Key || '').toLowerCase();
  const contentType = key.endsWith('.png')
    ? 'image/png'
    : key.endsWith('.webp')
    ? 'image/webp'
    : key.endsWith('.gif')
    ? 'image/gif'
    : 'image/jpeg';
  const signed = await signS3Reference(s3Ref, contentType);
  return signed?.url || signed?.secure_url || rawImage;
};

/**
 * Encode literal '+' characters in a presigned URL to avoid S3 InvalidToken errors.
 */
function encodeSignedUrl(url) {
  return url.replace(/\+/g, '%2B');
}

module.exports = {
  signS3Reference,
  stripS3ReferenceUrls,
  normalizeS3Reference,
  resolveProfileImageUrl,
  S3_MEDIA_URL_TTL_SECONDS,
  encodeSignedUrl,
};
