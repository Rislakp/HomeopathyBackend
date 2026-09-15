const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { cloudinary, isCloudinaryConfigured, uploadBufferToCloudinary } = require('../config/cloudinary');

// Ensure uploads directory exists ONLY as a last-resort dev fallback.
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper to sanitize filenames: replace spaces with hyphens and remove special characters
const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return 'file';
  return filename.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
};

// Disk storage — used ONLY when Cloudinary is NOT configured (local dev without .env)
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = (file.originalname || 'file')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9.\-_]/g, '');
    file.originalname = sanitizedName;
    cb(null, uniqueSuffix + '-' + sanitizedName);
  },
});

// Supported file extensions
const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
const ALLOWED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
const ALLOWED_DOC_FORMATS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar'];
const ALL_ALLOWED_FORMATS = [...ALLOWED_VIDEO_FORMATS, ...ALLOWED_IMAGE_FORMATS, ...ALLOWED_DOC_FORMATS];

// Max file upload limit: 200MB to support large video streams and live recordings
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '', 10) || 200 * 1024 * 1024;





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
  storage: multer.memoryStorage(),
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
      message: 'File size exceeds the allowed limit (200MB). Please select a smaller file.',
      error: err.message,
    });
  }

  const isCloudinaryErr = err.http_code || err.name === 'CloudinaryError' || (err.message || '').toLowerCase().includes('cloudinary');
  if (isCloudinaryErr) {
    const status = Number(err.http_code) >= 400 && Number(err.http_code) < 500 ? Number(err.http_code) : 400;
    return res.status(status).json({
      success: false,
      message: 'Cloudinary rejected the upload. Check file format and size limits.',
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
 * Middleware that guarantees every file object has a Cloudinary HTTPS secure_url.
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

  const isProd = process.env.NODE_ENV === 'production' || process.env.REQUIRE_CLOUDINARY === 'true';

  try {
    for (const file of files) {
      if (!file) continue;

      if (file.originalname) {
        file.originalname = sanitizeFilename(file.originalname);
      }

      // ── Case 1: CloudinaryStorage already uploaded — normalize URL fields ──
      const existingCloudUrl = (file.secure_url && file.secure_url.startsWith('http'))
        ? file.secure_url
        : (file.url && file.url.startsWith('http'))
          ? file.url
          : (file.path && file.path.startsWith('http'))
            ? file.path
            : null;

      if (existingCloudUrl) {
        file.secure_url = existingCloudUrl;
        file.url = existingCloudUrl;
        file.path = existingCloudUrl;
        continue;
      }

      // ── Case 2: Memory buffer — stream to Cloudinary ───────────────────────
      if (file.buffer && isCloudinaryConfigured()) {
        const mimetype = (file.mimetype || '').toLowerCase();
        const fieldname = (file.fieldname || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

        let folder = 'homeopathy-media';
        let resource_type = 'auto';

        if (mimetype.startsWith('video/') || fieldname.includes('video') || fieldname.includes('recording') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/videos';
          resource_type = 'video';
        } else if (mimetype === 'application/pdf' || ext === 'pdf') {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'raw';
        } else if (mimetype.startsWith('image/')) {
          folder = 'homeopathy-media/images';
          resource_type = 'image';
        } else {
          folder = 'homeopathy-media/attachments';
          resource_type = 'auto';
        }

        const cleanBaseName = path.parse(file.originalname || 'file').name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const uploaded = await uploadBufferToCloudinary(file, folder, {
          resource_type,
          public_id: `${cleanBaseName}-${uniqueSuffix}`,
        });

        file.secure_url = uploaded.secure_url;
        file.url = uploaded.secure_url;
        file.path = uploaded.secure_url;
        file.public_id = uploaded.public_id;
        file.resource_type = uploaded.resource_type;
        file.width = uploaded.width || file.width;
        file.height = uploaded.height || file.height;
        file.bytes = uploaded.bytes || file.size;
        file.format = uploaded.format || ext;
        continue;
      }

      // ── Case 3: Disk storage — stream to Cloudinary & delete local copy ────
      if (file.path && !file.path.startsWith('http') && isCloudinaryConfigured()) {
        try {
          const mimetype = (file.mimetype || '').toLowerCase();
          const fieldname = (file.fieldname || '').toLowerCase();
          const ext = path.extname(file.originalname || file.path || '').toLowerCase().replace('.', '');

          let folder = 'homeopathy-media';
          let resource_type = 'auto';

          if (mimetype.startsWith('video/') || fieldname.includes('video') || fieldname.includes('recording') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
            folder = 'homeopathy-media/videos';
            resource_type = 'video';
          } else if (mimetype === 'application/pdf' || ext === 'pdf') {
            folder = 'homeopathy-media/pdf-notes';
            resource_type = 'raw';
          } else if (mimetype.startsWith('image/')) {
            folder = 'homeopathy-media/images';
            resource_type = 'image';
          } else {
            folder = 'homeopathy-media/attachments';
            resource_type = 'auto';
          }

          const cleanName = path.parse(file.originalname || 'file').name.replace(/[^a-zA-Z0-9_-]/g, '_');
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

          const uploaded = await cloudinary.uploader.upload(file.path, {
            folder,
            resource_type,
            public_id: `${cleanName}-${uniqueSuffix}`,
            use_filename: false,
          });

          // Clean up local temp file
          fs.unlink(file.path, (err) => {
            if (err && err.code !== 'ENOENT') {
              console.warn(`Could not delete temp file ${file.path}:`, err.message);
            }
          });

          file.secure_url = uploaded.secure_url;
          file.url = uploaded.secure_url;
          file.path = uploaded.secure_url;
          file.public_id = uploaded.public_id;
          file.resource_type = uploaded.resource_type;
          file.width = uploaded.width || file.width;
          file.height = uploaded.height || file.height;
          file.bytes = uploaded.bytes || file.size;
          file.format = uploaded.format || ext;
          continue;
        } catch (diskUploadErr) {
          console.error('Failed to upload disk-landed file to Cloudinary:', diskUploadErr.message);
          if (isProd) {
            return res.status(500).json({
              success: false,
              message: 'Failed to upload media file to Cloudinary storage in production.',
              error: diskUploadErr.message,
            });
          }
        }
      }

      // ── Case 4: Pure local fallback (dev mode only) ──────────────────────
      if (isProd && (!file.secure_url || !file.secure_url.startsWith('http'))) {
        return res.status(500).json({
          success: false,
          message: 'Cloudinary storage is required in production. Local disk fallbacks are disabled.',
        });
      }

      if (file.filename || file.path) {
        const localPath = file.path && !file.path.startsWith('http')
          ? `/uploads/${path.basename(file.path)}`
          : `/uploads/${file.filename}`;
        file.secure_url = file.secure_url || localPath;
        file.url = file.url || localPath;
        file.path = file.path || localPath;
      }
    }

    return next();
  } catch (error) {
    console.error('Upload processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'File upload to Cloudinary failed. Please try again.',
      error: error.message,
    });
  }
};

upload.processUploadsToCloudinary = processUploadsToCloudinary;
upload.ALLOWED_VIDEO_FORMATS = ALLOWED_VIDEO_FORMATS;
upload.ALL_ALLOWED_FORMATS = ALL_ALLOWED_FORMATS;
upload.MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE;
upload.handleUploadError = handleUploadError;
upload.sanitizeFilename = sanitizeFilename;

module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports.handleUploadError = handleUploadError;
module.exports.sanitizeFilename = sanitizeFilename;
