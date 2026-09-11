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
  if (!isCloudinaryConfigured()) {
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

  return true;
};

configureCloudinary();

/**
 * Upload a memory buffer to Cloudinary via upload_stream
 * @param {Object} file - Express/Multer file object containing .buffer
 * @param {string} folder - Target folder in Cloudinary
 * @param {Object} [options] - Additional Cloudinary upload options (e.g. resource_type)
 */
const uploadBufferToCloudinary = (file, folder = 'homeopathy-media', options = {}) => {
  if (!isCloudinaryConfigured()) {
    return Promise.reject(new Error('Cloudinary credentials are not configured in process.env.'));
  }

  // Determine resource type from options or file mimetype
  let defaultResourceType = 'auto';
  if (options.resource_type) {
    defaultResourceType = options.resource_type;
  } else if (file && file.mimetype) {
    if (file.mimetype.startsWith('video/')) {
      defaultResourceType = 'video';
    } else if (file.mimetype.startsWith('audio/')) {
      defaultResourceType = 'video'; // Cloudinary uses 'video' resource_type for audio
    }
  }

  const uploadOptions = {
    folder,
    resource_type: defaultResourceType,
    use_filename: true,
    unique_filename: true,
    ...options,
  };

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    if (file && file.buffer) {
      Readable.from(file.buffer).pipe(stream);
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
    const publicId = contentParts.length > 1
      ? contentParts.slice(0, -1).concat(last.replace(/\.[^/.]+$/, '')).join('/')
      : last.replace(/\.[^/.]+$/, '');

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
    return await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType || 'image',
    });
  } catch (err) {
    // If destroy failed with specific resource type, retry with 'raw' or 'video'
    try {
      return await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    } catch (_) {
      try {
        return await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
      } catch (finalErr) {
        console.error(`Failed to delete Cloudinary asset ${publicId}:`, finalErr.message);
        return null;
      }
    }
  }
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

