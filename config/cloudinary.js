const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

const isCloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const configureCloudinary = () => {
  if (!isCloudinaryConfigured()) {
    return false;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return true;
};

configureCloudinary();

const uploadBufferToCloudinary = (file, folder = 'homeopathy-media') => {
  if (!isCloudinaryConfigured()) {
    return Promise.reject(new Error('Cloudinary credentials are not configured in process.env.'));
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
      },
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

const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const uploadIndex = pathParts.findIndex((part) => part === 'upload');

    if (uploadIndex === -1 || pathParts.length <= uploadIndex + 2) {
      return null;
    }

    const resourcePath = pathParts.slice(uploadIndex + 2);
    const last = resourcePath[resourcePath.length - 1];
    const publicId = resourcePath.length > 1
      ? resourcePath.map((part) => part).slice(0, -1).concat(last.replace(/\.[^/.]+$/, '')).join('/')
      : last.replace(/\.[^/.]+$/, '');

    return publicId;
  } catch (error) {
    return null;
  }
};

const deleteCloudinaryByUrl = async (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
    return null;
  }

  if (!isCloudinaryConfigured()) {
    return null;
  }

  const publicId = getPublicIdFromUrl(url);
  if (!publicId) {
    return null;
  }

  return cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
};

module.exports = {
  isCloudinaryConfigured,
  configureCloudinary,
  uploadBufferToCloudinary,
  deleteCloudinaryByUrl,
  getPublicIdFromUrl,
};
