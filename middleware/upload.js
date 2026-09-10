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

// Cloudinary storage configuration when Cloudinary credentials are provided.
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

        if (mimetype.startsWith('video/') || fieldname.includes('video')) {
          folder = 'homeopathy-media/videos';
          resource_type = 'video';
        } else if (mimetype === 'application/pdf' || fieldname.includes('pdf')) {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'auto';
        } else if (mimetype.startsWith('image/')) {
          folder = 'homeopathy-media/images';
          resource_type = 'image';
        } else {
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

// Comprehensive file filter for video parts, PDF notes, documents, and media
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /pdf|doc|docx|ppt|pptx|xls|xlsx|txt|csv|rtf|odt|jpg|jpeg|png|webp|gif|svg|mp4|avi|mov|mkv|flv|wmv|webm|m4v|mp3|wav|ogg|m4a|aac|zip|rar|7z/i;
  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

  if (!ext || allowedExtensions.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} is not allowed for lesson materials`));
  }
};

const upload = multer({
  storage: cloudinaryStorage || (isCloudinaryConfigured() ? multer.memoryStorage() : diskStorage),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for high-quality video & documents
  fileFilter,
});

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
        const mimetype = (file.mimetype || '').toLowerCase();
        if (mimetype.startsWith('video/')) folder = 'homeopathy-media/videos';
        else if (mimetype === 'application/pdf') folder = 'homeopathy-media/pdf-notes';
        else folder = 'homeopathy-media/attachments';

        const uploaded = await uploadBufferToCloudinary(file, folder);
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
      message: 'File upload processing failed',
      error: error.message,
    });
  }
};

upload.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;

