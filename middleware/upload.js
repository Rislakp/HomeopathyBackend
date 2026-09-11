const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary, isCloudinaryConfigured, uploadBufferToCloudinary } = require('../config/cloudinary');

// Ensure uploads directory exists ONLY as a last-resort dev fallback.
// On Render (ephemeral FS) this folder is wiped on restart, so Cloudinary
// must always be the primary destination in production.
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Disk storage — used ONLY when Cloudinary is NOT configured (local dev without .env)
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

// ── Cloudinary Storage (primary) ──────────────────────────────────────────────
// multer-storage-cloudinary streams directly from the incoming multipart stream
// to Cloudinary without touching the local disk — safe for Render ephemeral FS.
let cloudinaryStorage = null;
if (isCloudinaryConfigured()) {
  try {
    cloudinaryStorage = new CloudinaryStorage({
      cloudinary: cloudinary,
      params: async (req, file) => {
        const mimetype = (file.mimetype || '').toLowerCase();
        const fieldname = (file.fieldname || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

        let folder = 'homeopathy-media';
        let resource_type = 'auto';

        if (mimetype.startsWith('video/') || fieldname.includes('video') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/videos';
          resource_type = 'video';
        } else if (mimetype === 'application/pdf' || fieldname.includes('pdf') || ext === 'pdf') {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'auto';
        } else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
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
    console.log('✅ Cloudinary storage engine initialized — files will be uploaded to Cloudinary directly.');
  } catch (err) {
    console.error('⚠️  Failed to initialize CloudinaryStorage:', err.message);
    cloudinaryStorage = null;
  }
}

// ── Storage selection ─────────────────────────────────────────────────────────
// Priority:
//   1. CloudinaryStorage (direct stream)  — when Cloudinary is configured
//   2. memoryStorage                       — buffer fallback to stream via SDK
//   3. diskStorage                         — ONLY when Cloudinary is absent (local dev)
const chosenStorage = cloudinaryStorage
  ? cloudinaryStorage
  : isCloudinaryConfigured()
    ? multer.memoryStorage()   // buffer → streamed to Cloudinary in processUploadsToCloudinary
    : diskStorage;             // dev fallback only

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
  storage: chosenStorage,
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

  const isCloudinaryErr = err.http_code || err.name === 'CloudinaryError' || (err.message || '').toLowerCase().includes('cloudinary');
  if (isCloudinaryErr) {
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
 * Middleware that guarantees every file object has a Cloudinary HTTPS secure_url.
 *
 * Handles three cases in order:
 *   1. CloudinaryStorage already uploaded the file and set file.path / file.secure_url.
 *   2. memoryStorage buffer — stream it to Cloudinary via uploadBufferToCloudinary.
 *   3. diskStorage fallback — if Cloudinary is configured, stream the saved file to
 *      Cloudinary then delete the local copy; otherwise keep the local relative URL
 *      (acceptable only in dev without Cloudinary).
 *
 * After this middleware, controllers can always trust `file.secure_url` to be a
 * fully qualified HTTPS URL (Cloudinary) or a relative /uploads/ path (dev-only).
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
        const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

        let folder = 'homeopathy-media';
        let resource_type = 'auto';

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
        file.secure_url = uploaded.secure_url;
        file.url = uploaded.secure_url;
        file.path = uploaded.secure_url;
        file.public_id = uploaded.public_id;
        file.resource_type = uploaded.resource_type;
        continue;
      }

      // ── Case 3: Disk storage ───────────────────────────────────────────────
      // If Cloudinary IS configured but the file landed on disk (e.g., CloudinaryStorage
      // init failed at runtime), stream it to Cloudinary and delete the local copy.
      if (file.path && !file.path.startsWith('http') && isCloudinaryConfigured()) {
        try {
          const mimetype = (file.mimetype || '').toLowerCase();
          const ext = path.extname(file.originalname || file.path || '').toLowerCase().replace('.', '');

          let folder = 'homeopathy-media';
          let resource_type = 'auto';

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
          continue;
        } catch (diskUploadErr) {
          console.error('Failed to upload disk-landed file to Cloudinary:', diskUploadErr.message);
          // Fall through to local path fallback below
        }
      }

      // ── Case 4: Pure local fallback (no Cloudinary configured — dev only) ──
      if (file.filename || file.path) {
        const localPath = file.path && !file.path.startsWith('http')
          ? `/uploads/${path.basename(file.path)}`
          : `/uploads/${file.filename}`;
        file.secure_url = file.secure_url || localPath;
        file.url = file.url || localPath;
        file.path = file.path || localPath;

        if (isCloudinaryConfigured()) {
          // Warn loudly — this should never happen in production
          console.warn(
            `⚠️  File "${file.originalname}" was stored locally at "${localPath}" even though ` +
            `Cloudinary is configured. This URL will break on Render ephemeral storage.`
          );
        }
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

module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports.handleUploadError = handleUploadError;



