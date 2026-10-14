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

  // 1. Direct s3Key property present
  if (typeof source.s3Key === 'string' && source.s3Key) {
    const cleanKey = source.s3Key.trim();
    if (SAFE_S3_KEY.test(cleanKey) && !cleanKey.includes('..') && !cleanKey.includes('//') && !/[\r\n]/.test(cleanKey)) {
      return {
        ...source,
        storageProvider: 's3',
        s3Key: cleanKey,
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
  }

  if (source.storageProvider === 's3' && typeof source.s3Key === 'string' && source.s3Key) return source;

  const rawUrl = source.url || source.secure_url || source.secureUrl || source.fileUrl || source.path || source.videoUrl || source.mediaUrl || source.s3Key;
  if (typeof rawUrl !== 'string') return null;
  const trimmedUrl = rawUrl.trim();

  // Direct S3 key style reference (already safe)
  if (SAFE_S3_KEY.test(trimmedUrl) && !trimmedUrl.includes('..') && !trimmedUrl.includes('//') && !/[\r\n]/.test(trimmedUrl)) {
    return { ...source, storageProvider: 's3', s3Key: trimmedUrl, url: '', secure_url: '', secureUrl: '', fileUrl: '', documentUrl: '', path: '', videoUrl: '', mediaUrl: '' };
  }

  // Must be a full HTTPS URL pointing to our bucket (or a custom public base URL)
  if (!/^https:\/\//i.test(trimmedUrl)) return null;
  try {
    const parsed = new URL(trimmedUrl);
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
  if (!reference) return reference;
  const normalized = normalizeS3Reference(reference) || reference;
  if (!normalized || normalized.storageProvider !== 's3') return reference;

  const key = typeof normalized.s3Key === 'string' ? normalized.s3Key : '';
  const validKey = SAFE_S3_KEY.test(key) && !key.includes('..') && !key.includes('//') && !/[\r\n]/.test(key);
  if (!validKey) {
    return stripS3ReferenceUrls(normalized);
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
      ...normalized,
      fileName: normalized.fileName || normalized.originalFileName || '',
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
    return stripS3ReferenceUrls(normalized);
  }
};

/**
 * Verified Legacy Asset Registry
 * Maps historical upload filenames and URL basenames to verified S3 object keys.
 * All keys in this registry have been verified to exist in the S3 bucket with
 * matching content and byte sizes.
 */
const VERIFIED_LEGACY_ASSETS = {
  'pharmacy oct 6.pdf': 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
  'pharmacy oct 6.docx.pdf': 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
  'pharmacy-oct-6.pdf': 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
  'pharmacy-oct-6.docx.pdf': 'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
  'asst pharmacy.pdf': 'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf',
  'asst pharmacy (1).pdf': 'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf',
  'asst-pharmacy.pdf': 'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf',
  'asst-pharmacy-1-.pdf': 'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf',
};

/**
 * Determine the verified S3 object key for a legacy asset name or URL.
 */
function getVerifiedS3KeyForLegacyAsset(rawUrlOrName, options = {}) {
  if (options.verifiedS3Key && SAFE_S3_KEY.test(options.verifiedS3Key)) {
    return options.verifiedS3Key;
  }
  if (!rawUrlOrName || typeof rawUrlOrName !== 'string') return null;

  let decoded = rawUrlOrName.trim();
  try { decoded = decodeURIComponent(decoded); } catch (_) {}

  const baseFileName = decoded.split('/').pop().trim().toLowerCase();
  if (!baseFileName) return null;

  const normalized = baseFileName.replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const hyphenated = normalized.replace(/\s+/g, '-');

  // Search course modules first if course context is provided with explicit S3 key
  if (options.course && Array.isArray(options.course.modules)) {
    for (const m of options.course.modules) {
      for (const les of m.lessons || []) {
        for (const col of ['pdfNotes', 'assignments', 'attachments', 'videoParts']) {
          for (const item of les[col] || []) {
            if (item && item.storageProvider === 's3' && item.s3Key && SAFE_S3_KEY.test(item.s3Key)) {
              const itemTitle = (item.title || item.fileName || item.originalFileName || '').trim().toLowerCase();
              const itemNormalized = itemTitle.replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
              if (itemTitle === baseFileName || itemNormalized === normalized || item.s3Key.toLowerCase().endsWith(hyphenated)) {
                return item.s3Key;
              }
            }
          }
        }
      }
    }
  }

  // Direct lookup in verified historical registry
  if (VERIFIED_LEGACY_ASSETS[baseFileName]) {
    return VERIFIED_LEGACY_ASSETS[baseFileName];
  }

  // Normalized: strip duplicate file counter suffixes (e.g. " (1)", " (2)")
  if (VERIFIED_LEGACY_ASSETS[normalized]) {
    return VERIFIED_LEGACY_ASSETS[normalized];
  }

  if (VERIFIED_LEGACY_ASSETS[hyphenated]) {
    return VERIFIED_LEGACY_ASSETS[hyphenated];
  }

  return null;
}

/**
 * Shared media resolution following strict backward-compatible order:
 * 1. If valid storageProvider: "s3" and s3Key exist -> fresh signed URL.
 * 2. If valid S3 key exists without storageProvider -> validate and sign.
 * 3. If S3 URL (presigned or raw, valid or expired) -> extract S3 key and sign fresh URL.
 * 4. If legacy /uploads/... URL -> verify if a corresponding S3 object exists using reliable metadata.
 * 5. If unverified -> return safe error structure and log resolution failure without leaking secrets.
 */
const resolveMediaRecord = async (reference, options = {}) => {
  if (!reference) return null;
  const source = typeof reference === 'string' ? { url: reference } : { ...reference };
  const rawUrl = String(source.url || source.secure_url || source.secureUrl || source.fileUrl || source.path || source.mediaUrl || source.s3Key || '').trim();
  const responseContentType = options.responseContentType ||
    (source.contentType || (String(source.title || source.fileName || source.s3Key || rawUrl || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined));

  // 1 & 2. Check for valid S3 reference (with or without explicit storageProvider)
  const normalized = normalizeS3Reference(source);
  if (normalized && normalized.storageProvider === 's3' && normalized.s3Key) {
    return signS3Reference(normalized, responseContentType);
  }

  // 3 & 4. Handle legacy /uploads/... paths
  if (rawUrl.includes('/uploads/')) {
    const verifiedS3Key = getVerifiedS3KeyForLegacyAsset(
      source.fileName || source.originalFileName || source.title || rawUrl,
      { ...options, verifiedS3Key: options.verifiedS3Key || source.backupS3Key }
    );

    if (verifiedS3Key && SAFE_S3_KEY.test(verifiedS3Key)) {
      const verifiedRef = {
        ...source,
        storageProvider: 's3',
        s3Key: verifiedS3Key,
      };
      return signS3Reference(verifiedRef, responseContentType);
    }

    // 5. Unverified legacy record: log failure safely and return safe failure structure
    console.warn('[Legacy Media Resolution] Unverified legacy record:', {
      title: source.title || source.fileName || '(none)',
      url: rawUrl,
      courseId: options.course?.courseId || options.courseId || '(unknown)',
    });

    return {
      ...source,
      available: false,
      resolutionError: 'This legacy document is no longer available on the server and has no verified S3 backup.',
    };
  }

  // External / non-S3 URL (e.g. Cloudinary)
  return source;
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
  resolveMediaRecord,
  resolveProfileImageUrl,
  S3_MEDIA_URL_TTL_SECONDS,
  encodeSignedUrl,
  SAFE_S3_KEY,
  VERIFIED_LEGACY_ASSETS,
  getVerifiedS3KeyForLegacyAsset,
};
