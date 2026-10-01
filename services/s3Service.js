const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const { s3Client, bucket, region, publicBaseUrl, isS3Configured } = require('../config/s3');

/**
 * Clean and sanitize a filename for S3 key storage
 */
const cleanFileName = (name) => {
  if (!name || typeof name !== 'string') return 'file';
  return name
    .trim()
    .replace(/^.*[\\/]/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 160) || 'file';
};

/**
 * Construct public access URL for an S3 object key
 */
const getS3Url = (key) => {
  if (!key) return '';
  const cleanKey = key.replace(/^\/+/, '');
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/+$/, '')}/${cleanKey}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${cleanKey}`;
};

/**
 * Extract S3 object key from a full S3 URL or return the key if already formatted
 */
const getS3KeyFromUrl = (urlOrKey) => {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;
  const trimmed = urlOrKey.trim();

  // If already a raw S3 key (doesn't start with http/https)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed.replace(/^\/+/, '');
  }

  try {
    const parsed = new URL(trimmed);

    // If custom public base URL matches
    if (publicBaseUrl) {
      try {
        const baseParsed = new URL(publicBaseUrl);
        if (parsed.host === baseParsed.host) {
          return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        }
      } catch (e) {
        // Continue to standard domain checks
      }
    }

    // Standard virtual-hosted style: <bucket>.s3.<region>.amazonaws.com/<key>
    // or <bucket>.s3.amazonaws.com/<key>
    if (parsed.hostname.endsWith('.amazonaws.com')) {
      const parts = parsed.hostname.split('.');
      if (parts[0] === bucket) {
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      }
      // Path-style: s3.<region>.amazonaws.com/<bucket>/<key>
      if (parts[0] === 's3' || parts[1] === 's3') {
        const pathParts = parsed.pathname.replace(/^\/+/, '').split('/');
        if (pathParts[0] === bucket) {
          return decodeURIComponent(pathParts.slice(1).join('/'));
        }
      }
    }

    // Fallback: take pathname
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch (err) {
    return null;
  }
};

/**
 * Upload a memory buffer or file stream to AWS S3
 *
 * @param {Buffer|Uint8Array} buffer - File buffer
 * @param {Object} options - Upload options
 * @param {string} [options.originalname] - Original file name
 * @param {string} [options.mimetype] - MIME type
 * @param {string} [options.folder] - S3 prefix / folder (e.g. 'images', 'ranks', 'media')
 * @param {string} [options.customKey] - Explicit S3 key (optional)
 * @returns {Promise<Object>} Normalized upload result with secure_url, key, etc.
 */
const uploadBufferToS3 = async (buffer, options = {}) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Valid file buffer is required for S3 upload.');
  }

  const originalname = options.originalname || options.filename || 'file';
  const mimetype = options.mimetype || options.contentType || 'application/octet-stream';
  const folder = (options.folder || options.prefix || 'media').replace(/^\/+|\/+$/g, '');

  const ext = path.extname(originalname).toLowerCase().replace('.', '') || 'bin';
  const baseName = cleanFileName(path.basename(originalname, path.extname(originalname)));
  const sanitizedFullName = ext ? `${baseName}.${ext}` : baseName;

  const key = options.customKey || `${folder}/${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizedFullName}`;

  let resourceType = 'auto';
  if (mimetype.startsWith('image/')) resourceType = 'image';
  else if (mimetype.startsWith('video/')) resourceType = 'video';
  else if (mimetype.startsWith('audio/')) resourceType = 'audio';
  else if (mimetype === 'application/pdf') resourceType = 'pdf';

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    CacheControl: 'public, max-age=31536000',
  });

  await s3Client.send(command);

  const fileUrl = getS3Url(key);

  return {
    key,
    s3Key: key,
    public_id: key,
    secure_url: fileUrl,
    secureUrl: fileUrl,
    url: fileUrl,
    fileUrl: fileUrl,
    documentUrl: fileUrl,
    path: fileUrl,
    title: sanitizedFullName,
    original_name: originalname,
    originalname: originalname,
    fileName: sanitizedFullName,
    bytes: buffer.length,
    size: buffer.length,
    fileSize: buffer.length,
    mimetype,
    contentType: mimetype,
    resource_type: resourceType,
    resourceType,
    format: ext,
    storageProvider: 's3',
  };
};

/**
 * Upload a Multer file object (from memory or disk) to AWS S3
 *
 * @param {Object} file - Express/Multer file object
 * @param {string} [folder] - Target S3 folder
 * @param {Object} [options] - Additional options
 * @returns {Promise<Object>}
 */
const uploadFile = async (file, folder = 'media', options = {}) => {
  if (!file) throw new Error('File object is required for upload.');

  let buffer = file.buffer;

  // If multer stored to disk, read into buffer
  if (!buffer && file.path && fs.existsSync(file.path)) {
    buffer = await fs.promises.readFile(file.path);
    // Cleanup temporary local file after reading
    try {
      await fs.promises.unlink(file.path);
    } catch (e) {
      // Ignore unlink errors
    }
  }

  if (!buffer) {
    throw new Error(`File buffer is missing for file: ${file.originalname || 'unknown'}`);
  }

  return uploadBufferToS3(buffer, {
    originalname: file.originalname,
    mimetype: file.mimetype,
    folder,
    ...options,
  });
};

/**
 * Delete an object from AWS S3 by its key or public URL
 *
 * @param {string} keyOrUrl - S3 Key or complete public URL
 * @returns {Promise<{ success: boolean, key: string }>}
 */
const deleteFile = async (keyOrUrl) => {
  if (!keyOrUrl || typeof keyOrUrl !== 'string') {
    return { success: false, message: 'Invalid key or URL provided' };
  }

  const key = getS3KeyFromUrl(keyOrUrl);
  if (!key) {
    return { success: false, message: 'Could not resolve S3 key from URL' };
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await s3Client.send(command);
    return { success: true, key };
  } catch (error) {
    console.error(`[S3 Delete Error] Failed to delete key "${key}":`, error.message);
    throw error;
  }
};

/**
 * Check if an object exists in S3
 */
const checkObjectExists = async (keyOrUrl) => {
  const key = getS3KeyFromUrl(keyOrUrl);
  if (!key) return false;

  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
};

module.exports = {
  s3Client,
  bucket,
  region,
  isS3Configured,
  getS3Url,
  getFileUrl: getS3Url,
  getS3KeyFromUrl,
  uploadBufferToS3,
  uploadFile,
  deleteFile,
  checkObjectExists,
};
