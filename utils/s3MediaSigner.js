const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket, region, publicBaseUrl } = require('../config/s3');

const S3_MEDIA_URL_TTL_SECONDS = 900;
const SAFE_S3_KEY = /^(videos|images|pdfs|reviews|unani_ranks|[a-zA-Z0-9_-]+)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

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

const normalizeS3Reference = (reference) => {
  const source = typeof reference === 'string' ? { url: reference } : reference;
  if (!source || typeof source !== 'object') return null;
  if (source.storageProvider === 's3' && typeof source.s3Key === 'string' && source.s3Key) return source;

  const rawUrl = source.url || source.secure_url || source.secureUrl || source.fileUrl || source.path || source.videoUrl || source.mediaUrl || source.s3Key;
  if (typeof rawUrl !== 'string') return null;

  if (SAFE_S3_KEY.test(rawUrl) && !rawUrl.includes('..') && !rawUrl.includes('//') && !/[\\\r\n]/.test(rawUrl)) {
    return {
      ...source,
      storageProvider: 's3',
      s3Key: rawUrl,
      url: '',
      secure_url: '',
      secureUrl: '',
      fileUrl: '',
      documentUrl: '',
      path: '',
      videoUrl: '',
      mediaUrl: '',
    };
  }

  if (!/^https:\/\//i.test(rawUrl)) return null;

  try {
    const parsed = new URL(rawUrl);
    let keyPath = '';
    const expectedHosts = new Set([
      `${bucket}.s3.${region}.amazonaws.com`,
      `${bucket}.s3.amazonaws.com`,
    ]);
    if (publicBaseUrl) {
      try { expectedHosts.add(new URL(publicBaseUrl).hostname); } catch (_) { /* Ignore invalid optional base URLs. */ }
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
    if (!SAFE_S3_KEY.test(keyPath) || keyPath.includes('..') || keyPath.includes('//') || /[\\\r\n]/.test(keyPath)) return null;
    return {
      ...source,
      storageProvider: 's3',
      s3Key: keyPath,
      url: '',
      secure_url: '',
      secureUrl: '',
      fileUrl: '',
      documentUrl: '',
      path: '',
      videoUrl: '',
      mediaUrl: '',
    };
  } catch (_) {
    return null;
  }
};

const signS3Reference = async (reference, responseContentType) => {
  if (!reference || reference.storageProvider !== 's3') return reference;

  const key = typeof reference.s3Key === 'string' ? reference.s3Key : '';
  const validKey = SAFE_S3_KEY.test(key)
    && !key.includes('..')
    && !key.includes('//')
    && !/[\\\r\n]/.test(key);

  // An invalid S3 reference must never fall back to a stored/public URL or a legacy banner alias.
  if (!validKey) {
    return stripS3ReferenceUrls(reference);
  }

  try {
    const url = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(responseContentType ? { ResponseContentType: responseContentType, ResponseContentDisposition: 'inline' } : {}),
    }), { expiresIn: S3_MEDIA_URL_TTL_SECONDS });

    return {
      ...reference,
      fileName: reference.fileName || reference.originalFileName || '',
      url,
      secure_url: url,
      secureUrl: url,
      fileUrl: url,
      documentUrl: url,
      path: url,
      videoUrl: url,
      mediaUrl: url,
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

const resolveProfileImageUrl = async (rawImage) => {
  if (!rawImage || typeof rawImage !== 'string') return rawImage;
  const s3Ref = normalizeS3Reference(rawImage);
  if (!s3Ref) return rawImage;
  const signed = await signS3Reference(s3Ref);
  return signed?.url || signed?.secure_url || rawImage;
};

module.exports = { signS3Reference, stripS3ReferenceUrls, normalizeS3Reference, resolveProfileImageUrl, S3_MEDIA_URL_TTL_SECONDS };

