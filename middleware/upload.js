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
          console.log(`[processUploadsToCloudinary] Forced resource_type='video' for file: ${file.originalname} (mime=${mimetype}, ext=${ext}, field=${fieldname})`);
        } else if (mimetype === 'application/pdf' || ext === 'pdf') {
          folder = 'homeopathy-media/pdf-notes';
          resource_type = 'raw';
        } else if (ALLOWED_DOC_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/attachments';
          resource_type = 'raw';
        } else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
          folder = 'homeopathy-media/images';
          resource_type = 'image';
        } else {
          folder = 'homeopathy-media/attachments';
          resource_type = 'raw';
        }

        const parsed = path.parse(file.originalname || 'file');
        let baseName = parsed.name || 'file';
        let fileExt = (parsed.ext || '').toLowerCase().replace(/^\./, '');
        if (!fileExt && (mimetype === 'application/pdf' || ext === 'pdf')) {
          fileExt = 'pdf';
        } else if (!fileExt && ext) {
          fileExt = ext;
        }

        if (fileExt && baseName.toLowerCase().endsWith(`.${fileExt}`)) {
          baseName = baseName.slice(0, -(fileExt.length + 1));
        }

        const cleanBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'file';
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const isVideo = resource_type === 'video';

        // Cloudinary treats public_id for 'raw' files differently:
        // For 'image' and 'video', Cloudinary manages extensions separately via format transforms.
        // For 'raw' files (such as PDFs, docs, sheets, zips), the extension MUST be included in public_id
        // so Cloudinary generates and resolves the delivery URL with the proper extension (.pdf),
        // preventing 404 "Resource not found" errors when clients access or download the file.
        const publicId = (resource_type === 'raw' && fileExt)
          ? `${cleanBaseName}-${uniqueSuffix}.${fileExt}`
          : `${cleanBaseName}-${uniqueSuffix}`;

        const uploaded = await uploadBufferToCloudinary(file, folder, {
          resource_type,
          public_id: publicId,
          timeout: isVideo ? 600000 : 120000,
          ...(isVideo ? { chunk_size: 6000000 } : {}),
        });

        file.secure_url = uploaded.secure_url;
        file.url = uploaded.secure_url;
        file.path = uploaded.secure_url;
        file.public_id = uploaded.public_id;
        file.resource_type = uploaded.resource_type;
        file.width = uploaded.width || file.width;
        file.height = uploaded.height || file.height;
        file.bytes = uploaded.bytes || file.size;
        file.format = uploaded.format || fileExt || ext;
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
          } else if (ALLOWED_DOC_FORMATS.includes(ext)) {
            folder = 'homeopathy-media/attachments';
            resource_type = 'raw';
          } else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
            folder = 'homeopathy-media/images';
            resource_type = 'image';
          } else {
            folder = 'homeopathy-media/attachments';
            resource_type = 'raw';
          }

          const parsed = path.parse(file.originalname || file.path || 'file');
          let baseName = parsed.name || 'file';
          let fileExt = (parsed.ext || '').toLowerCase().replace(/^\./, '');
          if (!fileExt && (mimetype === 'application/pdf' || ext === 'pdf')) {
            fileExt = 'pdf';
          } else if (!fileExt && ext) {
            fileExt = ext;
          }

          if (fileExt && baseName.toLowerCase().endsWith(`.${fileExt}`)) {
            baseName = baseName.slice(0, -(fileExt.length + 1));
          }

          const cleanName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'file';
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          const isVideo = resource_type === 'video';

          const publicId = (resource_type === 'raw' && fileExt)
            ? `${cleanName}-${uniqueSuffix}.${fileExt}`
            : `${cleanName}-${uniqueSuffix}`;

          console.log(`[processUploadsToCloudinary Disk] Uploading file: "${file.originalname || file.path}", mimetype: "${mimetype}", size: ${file.size || 0} bytes, resource_type: "${resource_type}"`);

          const uploadDiskOptions = {
            folder,
            resource_type,
            public_id: publicId,
            use_filename: false,
            timeout: isVideo ? 600000 : 120000,
            ...(isVideo ? { chunk_size: 6000000 } : {}),
          };

          const uploaded = isVideo
            ? await cloudinary.uploader.upload_large(file.path, uploadDiskOptions)
            : await cloudinary.uploader.upload(file.path, uploadDiskOptions);

          console.log(`[processUploadsToCloudinary Disk SUCCESS] File: "${file.originalname || file.path}", public_id: "${uploaded.public_id}", resource_type: "${uploaded.resource_type}", bytes: ${uploaded.bytes || file.size}, url: "${uploaded.secure_url}"`);

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
          file.format = uploaded.format || fileExt || ext;
          continue;
        } catch (diskUploadErr) {
          console.error(`[processUploadsToCloudinary Disk ERROR] File: "${file.originalname || file.path}", error:`, diskUploadErr.message || diskUploadErr);
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
