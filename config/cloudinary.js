require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');


const isCloudinaryConfigured = () => Boolean(
  (process.env.CLOUDINARY_CLOUD_NAME &&
   process.env.CLOUDINARY_API_KEY &&
   process.env.CLOUDINARY_API_SECRET) ||
  process.env.CLOUDINARY_URL
);

const configureCloudinary = () => {
  const isProd = process.env.NODE_ENV === 'production' || process.env.REQUIRE_CLOUDINARY === 'true';

  if (!isCloudinaryConfigured()) {
    if (isProd) {
      throw new Error(
        'FATAL: Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET or CLOUDINARY_URL) ' +
        'are missing in production environment! All uploaded media assets must persist to Cloudinary.'
      );
    }
    console.warn('⚠️  Cloudinary credentials not set in process.env — using local disk fallback for dev only.');
    return false;
  }

  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloudinary_url: process.env.CLOUDINARY_URL,
      secure: true,
    });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  console.log(`[CloudinaryConfig] Cloud Name: ${cloudName || (cloudinaryUrl ? 'Set via CLOUDINARY_URL' : 'MISSING')}`);
  console.log(`[CloudinaryConfig] API Key: ${apiKey ? `***${apiKey.slice(-4)}` : (cloudinaryUrl ? 'Set via CLOUDINARY_URL' : 'MISSING')}`);
  console.log(`[CloudinaryConfig] API Secret: ${apiSecret ? 'PRESENT' : (cloudinaryUrl ? 'Set via CLOUDINARY_URL' : 'MISSING')}`);
  console.log(`✅ Cloudinary configured successfully (Cloud Name: ${cloudName || 'configured_cloud'}).`);
  return true;
};

configureCloudinary();

/**
 * Upload a memory buffer to Cloudinary via upload_stream or upload_chunked_stream
 * @param {Object} file - Express/Multer file object containing .buffer
 * @param {string} folder - Target folder in Cloudinary
 * @param {Object} [options] - Additional Cloudinary upload options (e.g. resource_type)
 */
const uploadBufferToCloudinary = (file, folder = 'homeopathy-media', options = {}) => {
  if (!isCloudinaryConfigured()) {
    return Promise.reject(new Error('Cloudinary credentials are not configured in process.env.'));
  }

  const fileName = file ? (file.originalname || file.filename || 'file') : 'file';
  const fileMime = (file && file.mimetype ? file.mimetype : '').toLowerCase();
  const fileSize = file && file.buffer ? file.buffer.length : (file && file.size ? file.size : 0);

  // Determine resource type from options or file mimetype/extension
  let defaultResourceType = 'auto';
  const isVideoOrAudio = (options.resource_type === 'video') ||
    fileMime.startsWith('video/') ||
    fileMime.startsWith('audio/') ||
    /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v|mp3|wav|m4a)$/i.test(fileName);

  if (isVideoOrAudio) {
    defaultResourceType = 'video';
  } else if (options.resource_type) {
    defaultResourceType = options.resource_type;
  } else if (fileMime === 'application/pdf' || /\.pdf$/i.test(fileName)) {
    defaultResourceType = 'raw';
  } else if (fileMime.startsWith('image/')) {
    defaultResourceType = 'image';
  }

  const isVideo = defaultResourceType === 'video';

  if (isVideo) {
    console.log('[VIDEO UPLOAD] File received');
    console.log(`[VIDEO UPLOAD] Filename: ${fileName}`);
    console.log(`[VIDEO UPLOAD] MIME: ${fileMime || 'video/mp4'}`);
    console.log(`[VIDEO UPLOAD] Size: ${fileSize}`);
    console.log('[VIDEO UPLOAD] Starting Cloudinary upload');
  } else {
    console.log(`[Cloudinary Video/Media Upload] Received file: "${fileName}", mimetype: "${fileMime || 'unknown'}", size: ${fileSize} bytes, resource_type: "${defaultResourceType}"`);
  }

  const uploadOptions = {
    folder,
    resource_type: defaultResourceType,
    use_filename: options.public_id ? false : true,
    unique_filename: options.public_id ? false : true,
    timeout: isVideo ? 600000 : 120000, // 10 minutes for videos, 2 minutes for other media
    ...(isVideo ? { chunk_size: 6000000 } : {}), // 6MB chunk size for video chunked uploads
    ...options,
  };

  return new Promise((resolve, reject) => {
    // For videos or large files (>10MB), use upload_chunked_stream for reliable chunked transfer
    const uploaderMethod = (isVideo || fileSize > 10 * 1024 * 1024)
      ? cloudinary.uploader.upload_chunked_stream.bind(cloudinary.uploader)
      : cloudinary.uploader.upload_stream.bind(cloudinary.uploader);

    const stream = uploaderMethod(
      uploadOptions,
      (error, result) => {
        if (error) {
          if (isVideo) {
            console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${error.message || error}`);
          }
          console.error(`[Cloudinary Upload ERROR] File: "${fileName}", mimetype: "${fileMime}", size: ${fileSize}, resource_type: "${defaultResourceType}", error:`, error.message || error);
          reject(error);
          return;
        }
        if (!result || !result.secure_url || !result.public_id || !result.resource_type || !(Number(result.bytes) > 0)) {
          reject(new Error('Cloudinary returned an incomplete upload response.'));
          return;
        }
        if (isVideo) {
          console.log('[VIDEO UPLOAD] Cloudinary upload successful');
          console.log(`[VIDEO UPLOAD] Resource type: ${result.resource_type}`);
          console.log(`[VIDEO UPLOAD] Secure URL: ${result.secure_url}`);
        }
        console.log(`[Cloudinary Upload SUCCESS] File: "${fileName}", public_id: "${result.public_id}", resource_type: "${result.resource_type}", bytes: ${result.bytes || fileSize}, url: "${result.secure_url}"`);
        resolve(result);
      }
    );

    if (stream && typeof stream.on === 'function') {
      stream.on('error', (streamErr) => {
        if (isVideo) {
          console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${streamErr.message || streamErr}`);
        }
        console.error(`[Cloudinary Stream ERROR] File: "${fileName}", error:`, streamErr.message || streamErr);
        reject(streamErr);
      });
    }

    if (file && file.buffer) {
      const readable = Readable.from(file.buffer);
      readable.on('error', (readErr) => {
        if (isVideo) {
          console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${readErr.message || readErr}`);
        }
        console.error(`[Cloudinary Buffer Readable ERROR] File: "${fileName}", error:`, readErr.message || readErr);
        reject(readErr);
      });
      readable.pipe(stream);
    } else {
      reject(new Error('Upload buffer is missing for Cloudinary upload.'));
    }
  });
};

/**
 * Parse public ID and resource type from a Cloudinary URL
 */
const parseCloudinaryUrl = (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    // Path structure: /<cloud_name>/<resource_type>/<type>/v<version>/<public_id>.<ext>
    const uploadIndex = pathParts.findIndex((part) => part === 'upload');

    if (uploadIndex === -1 || pathParts.length <= uploadIndex + 1) {
      return null;
    }

    const resourceType = uploadIndex > 0 ? pathParts[uploadIndex - 1] : 'image';
    const resourcePath = pathParts.slice(uploadIndex + 1);

    // Skip version tag (e.g. v1234567890) if present
    const contentParts = resourcePath[0] && resourcePath[0].startsWith('v') && /^\d+$/.test(resourcePath[0].substring(1))
      ? resourcePath.slice(1)
      : resourcePath;

    if (!contentParts.length) return null;

    const last = contentParts[contentParts.length - 1];
    // For raw files in Cloudinary, the file extension is considered part of the public ID.
    // For image and video assets, the extension is stripped because Cloudinary appends it as format.
    const publicId = resourceType === 'raw'
      ? contentParts.join('/')
      : (contentParts.length > 1
          ? contentParts.slice(0, -1).concat(last.replace(/\.[^/.]+$/, '')).join('/')
          : last.replace(/\.[^/.]+$/, ''));

    return { publicId, resourceType };
  } catch (error) {
    return null;
  }
};

const getPublicIdFromUrl = (url) => {
  const parsed = parseCloudinaryUrl(url);
  return parsed ? parsed.publicId : null;
};

const deleteCloudinaryByUrl = async (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
    return null;
  }

  if (!isCloudinaryConfigured()) {
    return null;
  }

  const parsed = parseCloudinaryUrl(url);
  if (!parsed || !parsed.publicId) {
    return null;
  }

  const { publicId, resourceType } = parsed;

  try {
    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType || 'image',
    });
    if (res && res.result === 'ok') return res;
  } catch (_) {}

  // If resourceType is raw, retry with/without extension in case asset was stored alternately
  if (resourceType === 'raw') {
    try {
      const altId = publicId.includes('.') ? publicId.replace(/\.[^/.]+$/, '') : publicId;
      if (altId !== publicId) {
        const altRes = await cloudinary.uploader.destroy(altId, { resource_type: 'raw' });
        if (altRes && altRes.result === 'ok') return altRes;
      }
    } catch (_) {}
  }

  // Retry with other resource types
  for (const rType of ['video', 'raw', 'image']) {
    if (rType !== resourceType) {
      try {
        const res = await cloudinary.uploader.destroy(publicId, { resource_type: rType });
        if (res && res.result === 'ok') return res;
      } catch (_) {}
    }
  }

  return null;
};

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  configureCloudinary,
  uploadBufferToCloudinary,
  deleteCloudinaryByUrl,
  getPublicIdFromUrl,
  parseCloudinaryUrl,
};

