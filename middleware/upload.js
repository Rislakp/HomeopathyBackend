const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary, isCloudinaryConfigured, uploadBufferToCloudinary } = require('../config/cloudinary');

// Ensure uploads directory exists for optional fallback when Cloudinary is not configured.
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Disk storage configuration for the local fallback path when Cloudinary is disabled/offline.
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const cleanName = path.parse(file.originalname || 'file').name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || '');
    cb(null, `${file.fieldname}-${cleanName}-${uniqueSuffix}${ext}`);
  },
});

// Supported file extensions
const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
const ALLOWED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
const ALLOWED_DOC_FORMATS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar'];
const ALL_ALLOWED_FORMATS = [...ALLOWED_VIDEO_FORMATS, ...ALLOWED_IMAGE_FORMATS, ...ALLOWED_DOC_FORMATS];
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

// Cloudinary storage configuration
let cloudinaryStorage;
if (isCloudinaryConfigured()) {
  try {
    cloudinaryStorage = new CloudinaryStorage({
      cloudinary: cloudinary,
      params: async (req, file) => {
        let folder = 'homeopathy-media';
        let resource_type = 'auto';

        const mimetype = (file.mimetype || '').toLowerCase();
        const fieldname = (file.fieldname || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

        // 1. Video files -> homeopathy-media/videos
        if (mimetype.startsWith('video/') || fieldname.includes('video') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/videos';
          resource_type = 'video';
        }
        // 2. PDF notes -> homeopathy-media/pdf-notes
        else if (mimetype === 'application/pdf' || fieldname.includes('pdf') || ext === 'pdf') {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'auto';
        }
        // 3. Images -> homeopathy-media/images
        else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/images';
          resource_type = 'image';
        }
        // 4. Attachments & Docs -> homeopathy-media/attachments
        else {
          folder = 'homeopathy-media/attachments';
          resource_type = 'auto';
        }

        const cleanName = path.parse(file.originalname || 'file').name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

        return {
          folder,
          resource_type,
          public_id: `${cleanName}-${uniqueSuffix}`,
        };
      },
    });
  } catch (err) {
    console.error('Failed to initialize CloudinaryStorage, falling back to disk storage:', err);
    cloudinaryStorage = null;
  }
}

// File filter with informative error messages
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

  if (!ext || ALL_ALLOWED_FORMATS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File format .${ext} is not supported. Allowed formats include: ${ALL_ALLOWED_FORMATS.join(', ')}`));
  }
};

const upload = multer({
  storage: cloudinaryStorage || (isCloudinaryConfigured() ? multer.memoryStorage() : diskStorage),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
  },
  fileFilter,
});

const handleUploadError = (err, req, res, next) => {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File size exceeds the allowed limit (100MB). Please select a smaller file.',
      error: err.message,
    });
  }

  const cloudinaryMessage = err.http_code || err.name === 'CloudinaryError' || err.message?.toLowerCase().includes('cloudinary');
  if (cloudinaryMessage) {
    const status = Number(err.http_code) >= 400 && Number(err.http_code) < 500 ? Number(err.http_code) : 400;
    return res.status(status).json({
      success: false,
      message: 'Cloudinary rejected the upload. Check the file format and size limits.',
      error: err.message || 'Cloudinary upload failed',
    });
  }

  return res.status(400).json({
    success: false,
    message: err.message || 'File upload error',
    error: err.message,
  });
};

/**
 * Middleware ensuring uploaded files have normalized secure URLs.
 * Handles CloudinaryStorage objects, memory buffers, and diskStorage fallbacks.
 */
const processUploadsToCloudinary = async (req, res, next) => {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else {
      files.push(...Object.values(req.files).flat());
    }
  }

  if (!files.length) {
    return next();
  }

  try {
    for (const file of files) {
      if (!file) continue;

      // Case 1: CloudinaryStorage has already uploaded the stream and assigned file.path / file.secure_url
      if (file.path && file.path.startsWith('http')) {
        file.secure_url = file.path;
        file.url = file.path;
        continue;
      }

      // Case 2: In-memory buffer from memoryStorage -> stream to Cloudinary
      if (file.buffer && isCloudinaryConfigured()) {
        let folder = 'homeopathy-media';
        let resource_type = 'auto';

        const mimetype = (file.mimetype || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

        if (mimetype.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/videos';
          resource_type = 'video';
        } else if (mimetype === 'application/pdf' || ext === 'pdf') {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'auto';
        } else if (mimetype.startsWith('image/')) {
          folder = 'homeopathy-media/images';
          resource_type = 'image';
        } else {
          folder = 'homeopathy-media/attachments';
          resource_type = 'auto';
        }

        const uploaded = await uploadBufferToCloudinary(file, folder, { resource_type });
        file.path = uploaded.secure_url;
        file.url = uploaded.secure_url;
        file.secure_url = uploaded.secure_url;
        file.public_id = uploaded.public_id;
        file.resource_type = uploaded.resource_type;
        continue;
      }

      // Case 3: Local disk storage fallback
      if (file.filename) {
        const localPath = `/uploads/${file.filename}`;
        file.secure_url = file.secure_url || localPath;
        file.url = file.url || localPath;
        file.path = file.path || localPath;
      }
    }

    return next();
  } catch (error) {
    console.error('Upload processing error:', error);
    return res.status(400).json({
      success: false,
      message: 'Cloudinary upload failed',
      error: error.message,
    });
  }
};

upload.processUploadsToCloudinary = processUploadsToCloudinary;
upload.ALLOWED_VIDEO_FORMATS = ALLOWED_VIDEO_FORMATS;
upload.ALL_ALLOWED_FORMATS = ALL_ALLOWED_FORMATS;
upload.MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE;
upload.handleUploadError = handleUploadError;

module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports.handleUploadError = handleUploadError;


