const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucket } = require('../config/s3');

const S3_MEDIA_URL_TTL_SECONDS = 900;
const SAFE_S3_KEY = /^(videos|live_records|images|pdfs)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

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

const signS3Reference = async (reference, responseContentType) => {
  if (!reference) return reference;

  const declaredProvider = String(reference.storageProvider || '').trim().toLowerCase();
  // Older course records may have only an S3 key. An explicit non-S3 provider
  // remains authoritative so Cloudinary and other legacy URLs are untouched.
  if (declaredProvider && declaredProvider !== 's3') return reference;

  const key = typeof reference.s3Key === 'string'
    ? reference.s3Key
    : (typeof reference.key === 'string' ? reference.key : '');
  const validKey = SAFE_S3_KEY.test(key)
    && !key.includes('..')
    && !key.includes('//')
    && !/[\\\r\n]/.test(key);

  // Untagged legacy resources are not assumed to be S3. Preserve their URLs
  // unless they carry a valid S3 key; explicit S3 resources remain fail-closed.
  if (!validKey) {
    if (!declaredProvider) return reference;
    return stripS3ReferenceUrls(reference);
  }

  const url = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(responseContentType ? { ResponseContentType: responseContentType, ResponseContentDisposition: 'inline' } : {}),
  }), { expiresIn: S3_MEDIA_URL_TTL_SECONDS });

  return {
    ...reference,
    storageProvider: 's3',
    s3Key: key,
    fileName: reference.fileName || reference.originalFileName || '',
    url,
    secure_url: url,
    secureUrl: url,
    fileUrl: url,
    documentUrl: url,
    path: url,
    accessUrlExpiresIn: S3_MEDIA_URL_TTL_SECONDS,
  };
};

module.exports = { signS3Reference, stripS3ReferenceUrls, S3_MEDIA_URL_TTL_SECONDS };
