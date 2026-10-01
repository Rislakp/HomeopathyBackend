const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket, region, publicBaseUrl } = require('../config/s3');

const S3_MEDIA_URL_TTL_SECONDS = 900;
const SAFE_S3_KEY = /^(videos|images|pdfs)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

const stripS3ReferenceUrls = (reference) => ({
  ...reference,
  fileName: reference.fileName || reference.originalFileName || '',
  url: '',
  secure_url: '',
  secureUrl: '',
  fileUrl: '',
  documentUrl: '',
  path: '',
});

const normalizeS3Reference = (reference) => {
  const source = typeof reference === 'string' ? { url: reference } : reference;
  if (!source || typeof source !== 'object') return null;
  if (source.storageProvider === 's3' && typeof source.s3Key === 'string' && source.s3Key) return source;

  const rawUrl = source.url || source.secure_url || source.secureUrl || source.fileUrl || source.path;
  if (typeof rawUrl !== 'string' || !/^https:\/\//i.test(rawUrl)) return null;

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
    if (!expectedHosts.has(parsed.hostname)) return null;

    keyPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
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

module.exports = { signS3Reference, stripS3ReferenceUrls, normalizeS3Reference, S3_MEDIA_URL_TTL_SECONDS };
