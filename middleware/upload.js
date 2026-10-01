const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { isS3Configured, uploadFile: uploadToS3 } = require('../services/s3Service');
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

// Disk storage — used ONLY when neither S3 nor Cloudinary is configured (local dev without .env)
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

/**
 * Cleanly separates the base name and extension from a given filename or path.
 */
const extractCleanNameAndExt = (originalName, fallbackExt = '') => {
  if (!originalName || typeof originalName !== 'string') {
    const ext = (fallbackExt || '').toLowerCase().replace(/^\./, '');
    return { cleanBaseName: 'file', ext, fullName: ext ? `file.${ext}` : 'file' };
  }

  const basePart = originalName.split(/[/\\]/).pop() || 'file';
  let rawName = basePart.trim();
  let ext = '';
  let baseNamePart = rawName;

  const lastDotIndex = rawName.lastIndexOf('.');
  if (lastDotIndex > 0 && lastDotIndex < rawName.length - 1) {
    baseNamePart = rawName.substring(0, lastDotIndex);
    ext = rawName.substring(lastDotIndex + 1).toLowerCase();
  } else if (fallbackExt) {
    ext = fallbackExt.toLowerCase().replace(/^\./, '');
  }

  if (ext) {
    const mangledPattern = new RegExp(`[_-]${ext}$`, 'i');
    baseNamePart = baseNamePart.replace(mangledPattern, '');
  }

  for (const fmt of ALL_ALLOWED_FORMATS) {
    if (baseNamePart.toLowerCase().endsWith(`_${fmt}`) || baseNamePart.toLowerCase().endsWith(`-${fmt}`)) {
      baseNamePart = baseNamePart.slice(0, -(fmt.length + 1));
      if (!ext) ext = fmt;
      break;
    }
  }

  let cleanBaseName = baseNamePart
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleanBaseName) cleanBaseName = 'file';

  const fullName = ext ? `${cleanBaseName}.${ext}` : cleanBaseName;
  return { cleanBaseName, ext, fullName };
};

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

  const isStorageErr = err.http_code || err.name === 'CloudinaryError' || err.name === 'S3Error' || (err.message || '').toLowerCase().includes('cloudinary') || (err.message || '').toLowerCase().includes('s3');
  if (isStorageErr) {
    const status = Number(err.http_code) >= 400 && Number(err.http_code) < 500 ? Number(err.http_code) : 400;
    return res.status(status).json({
      success: false,
      message: 'Storage upload rejected. Check file format and size limits.',
      error: err.message || 'Storage upload failed',
    });
  }

  return res.status(400).json({
    success: false,
    message: err.message || 'File upload error',
    error: err.message,
  });
};

/**
 * Middleware that guarantees every uploaded file object is persisted to AWS S3 (primary)
 * or Cloudinary (fallback) and has a valid HTTPS secure_url attached.
 */
const processUploads = async (req, res, next) => {
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

  const useS3 = isS3Configured();
  const useCloudinary = !useS3 && isCloudinaryConfigured();

  try {
    for (const file of files) {
      if (!file) continue;

      const originalName = file.originalname || 'unknown';
      const originalMimeType = (file.mimetype || '').toLowerCase();
      const originalSize = Number(file.size || (file.buffer && file.buffer.length) || 0);
      const extension = path.extname(originalName).toLowerCase();
      const isPdf = originalMimeType === 'application/pdf' || extension === '.pdf';

      if (isPdf) {
        let header = '';
        if (file.buffer && Buffer.isBuffer(file.buffer)) {
          header = file.buffer.subarray(0, 5).toString('ascii');
        } else if (file.path && fs.existsSync(file.path)) {
          try {
            const fd = fs.openSync(file.path, 'r');
            const buffer = Buffer.alloc(5);
            fs.readSync(fd, buffer, 0, 5, 0);
            fs.closeSync(fd);
            header = buffer.toString('ascii');
          } catch (e) {}
        }

        if (header !== '%PDF-') {
          return res.status(400).json({
            success: false,
            message: 'Invalid PDF file. The upload does not contain a valid PDF signature.',
          });
        }
        file.mimetype = 'application/pdf';
        if (file.buffer) file.size = file.buffer.length;
      }

      if (file.originalname) {
        file.originalname = sanitizeFilename(file.originalname);
      }

      // If already has a full HTTP URL, normalize
      const existingUrl = (file.secure_url && file.secure_url.startsWith('http'))
        ? file.secure_url
        : (file.url && file.url.startsWith('http'))
          ? file.url
          : (file.path && file.path.startsWith('http'))
            ? file.path
            : null;

      if (existingUrl) {
        file.secure_url = existingUrl;
        file.url = existingUrl;
        file.path = existingUrl;
        file.fileUrl = existingUrl;
        continue;
      }

      // Determine appropriate folder
      const mimetype = (file.mimetype || '').toLowerCase();
      const fieldname = (file.fieldname || '').toLowerCase();
      const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');

      let folder = (req.body && req.body.folder && String(req.body.folder).trim())
        ? String(req.body.folder).trim()
        : 'media';

      if (mimetype.startsWith('video/') || fieldname.includes('video') || fieldname.includes('recording') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
        if (!req.body || !req.body.folder) folder = 'videos';
      } else if (mimetype === 'application/pdf' || ext === 'pdf') {
        if (!req.body || !req.body.folder) folder = 'pdfs';
      } else if (fieldname.includes('rank') || fieldname.includes('profile')) {
        if (!req.body || !req.body.folder) folder = 'ranks';
      } else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
        if (!req.body || !req.body.folder) folder = 'images';
      }

      // ── Strategy A: AWS S3 (Primary) ──────────────────────────────────────
      if (useS3 && (file.buffer || file.path)) {
        try {
          const s3Result = await uploadToS3(file, folder);
          file.secure_url = s3Result.secure_url;
          file.url = s3Result.url;
          file.fileUrl = s3Result.fileUrl;
          file.documentUrl = s3Result.documentUrl;
          file.path = s3Result.secure_url;
          file.public_id = s3Result.key;
          file.s3Key = s3Result.key;
          file.key = s3Result.key;
          file.storageProvider = 's3';
          file.resource_type = s3Result.resource_type;
          file.bytes = s3Result.bytes;
          file.size = s3Result.size;
          continue;
        } catch (s3Err) {
          console.error('[Upload Middleware] S3 upload error:', s3Err.message);
          // If Cloudinary is available, fallback to Cloudinary
          if (!isCloudinaryConfigured()) {
            throw s3Err;
          }
        }
      }

      // ── Strategy B: Cloudinary (Fallback if configured) ───────────────────
      if (isCloudinaryConfigured() && file.buffer) {
        const cldFolder = folder.startsWith('homeopathy-media') ? folder : `homeopathy-media/${folder}`;
        const { cleanBaseName, ext: fileExt } = extractCleanNameAndExt(file.originalname, ext);
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        let resource_type = 'auto';
        if (mimetype.startsWith('video/')) resource_type = 'video';
        else if (mimetype.startsWith('image/')) resource_type = 'image';

        const publicId = (resource_type === 'raw' && fileExt)
          ? `${cleanBaseName}-${uniqueSuffix}.${fileExt}`
          : `${cleanBaseName}-${uniqueSuffix}`;

        const uploaded = await uploadBufferToCloudinary(file, cldFolder, {
          resource_type,
          public_id: publicId,
          use_filename: false,
          unique_filename: false,
          access_mode: 'public',
        });

        file.secure_url = uploaded.secure_url;
        file.url = uploaded.secure_url;
        file.fileUrl = uploaded.secure_url;
        file.documentUrl = uploaded.secure_url;
        file.path = uploaded.secure_url;
        file.public_id = uploaded.public_id;
        file.resource_type = uploaded.resource_type;
        file.bytes = uploaded.bytes || file.size;
        file.storageProvider = 'cloudinary';
        continue;
      }

      // ── Strategy C: Local disk fallback (dev only) ────────────────────────
      if (file.buffer) {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${sanitizeFilename(file.originalname)}`;
        const localPath = path.join(uploadsDir, uniqueName);
        await fs.promises.writeFile(localPath, file.buffer);
        file.filename = uniqueName;
        file.path = `/uploads/${uniqueName}`;
        file.secure_url = file.path;
        file.url = file.path;
        file.fileUrl = file.path;
        file.storageProvider = 'local';
      }
    }

    req.uploadedFiles = files;
    return next();
  } catch (err) {
    console.error('[Upload Middleware ERROR]:', err);
    return res.status(500).json({
      success: false,
      message: 'File upload failed. Please try again.',
      error: err.message,
    });
  }
};

// Aliases for seamless backward compatibility across all existing routes
const processUploadsToCloudinary = processUploads;

upload.processUploadsToCloudinary = processUploads;
upload.processUploads = processUploads;

module.exports = upload;
module.exports.upload = upload;
module.exports.handleUploadError = handleUploadError;
module.exports.processUploads = processUploads;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
