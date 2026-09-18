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

/**
 * Cleanly separates the base name and extension from a given filename or path.
 * Prevents mangling of the extension dot into underscores (e.g. preventing 'video1_mp4').
 * Handles Windows (\) and POSIX (/) path separators safely.
 * Strips any pre-existing mangled extension suffix (e.g., '_mp4', '-mp4') from the base name.
 *
 * @param {string} originalName - Original filename or path
 * @param {string} [fallbackExt=''] - Fallback extension if none found
 * @returns {{ cleanBaseName: string, ext: string, fullName: string }}
 */
const extractCleanNameAndExt = (originalName, fallbackExt = '') => {
  if (!originalName || typeof originalName !== 'string') {
    const ext = (fallbackExt || '').toLowerCase().replace(/^\./, '');
    return { cleanBaseName: 'file', ext, fullName: ext ? `file.${ext}` : 'file' };
  }

  // Handle both Windows (\) and POSIX (/) path separators safely
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

  // If the base name ends with '_mp4', '-mp4', etc., strip that mangled extension suffix
  if (ext) {
    const mangledPattern = new RegExp(`[_-]${ext}$`, 'i');
    baseNamePart = baseNamePart.replace(mangledPattern, '');
  }

  // Check for any other known format stuck to baseName with underscore or hyphen (e.g. 'video1_mp4')
  for (const fmt of ALL_ALLOWED_FORMATS) {
    if (baseNamePart.toLowerCase().endsWith(`_${fmt}`) || baseNamePart.toLowerCase().endsWith(`-${fmt}`)) {
      baseNamePart = baseNamePart.slice(0, -(fmt.length + 1));
      if (!ext) ext = fmt;
      break;
    }
  }

  // Clean base name: preserve alphanumeric, dashes, and underscores
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

  console.log(`[processUploadsToCloudinary] req.file exists: ${Boolean(req.file)}, req.files count: ${files.length}`);
  if (files.length > 0) {
    files.forEach((f, idx) => {
      console.log(`[processUploadsToCloudinary] File #${idx + 1}: originalname="${f.originalname || 'unknown'}", fieldname="${f.fieldname || 'unknown'}", mimetype="${f.mimetype || 'unknown'}", size=${f.size || (f.buffer ? f.buffer.length : 0)} bytes`);
    });
  }

  if (!files.length) {
    return next();
  }

  const isProd = process.env.NODE_ENV === 'production' || process.env.REQUIRE_CLOUDINARY === 'true';

  try {
    for (const file of files) {
      if (!file) continue;

      const originalName = file.originalname || 'unknown';
      const originalMimeType = (file.mimetype || '').toLowerCase();
      const originalSize = Number(file.size || (file.buffer && file.buffer.length) || 0);
      const extension = path.extname(originalName).toLowerCase();
      const isPdf = originalMimeType === 'application/pdf' || extension === '.pdf';

      if (isPdf) {
        const header = file.buffer && Buffer.isBuffer(file.buffer)
          ? file.buffer.subarray(0, 5).toString('ascii')
          : '';
        console.log('========== PDF UPLOAD ==========');
        console.log(`filename: ${originalName}`);
        console.log(`mimetype: ${originalMimeType || 'unknown'}`);
        console.log(`size: ${originalSize}`);
        console.log(`first bytes: ${header}`);
        console.log('================================');

        if (!file.buffer || !Buffer.isBuffer(file.buffer) || header !== '%PDF-') {
          return res.status(400).json({
            success: false,
            message: 'Invalid PDF file. The upload does not contain a valid PDF signature.',
          });
        }
        file.mimetype = 'application/pdf';
        file.size = file.buffer.length;
      }

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

        let folder = (req.body && req.body.folder && String(req.body.folder).trim())
          ? String(req.body.folder).trim()
          : 'homeopathy-media';
        let resource_type = 'auto';

        if (mimetype.startsWith('video/') || fieldname.includes('video') || fieldname.includes('recording') || ALLOWED_VIDEO_FORMATS.includes(ext)) {
          if (!req.body || !req.body.folder) folder = 'homeopathy-media/videos';
          resource_type = 'video';
          console.log(`[processUploadsToCloudinary] Forced resource_type='video' for file: ${file.originalname} (mime=${mimetype}, ext=${ext}, field=${fieldname})`);
        } else if (mimetype === 'application/pdf' || ext === 'pdf') {
          if (!req.body || !req.body.folder) folder = 'homeopathy-media/pdf-notes';
          resource_type = 'raw';
        } else if (ALLOWED_DOC_FORMATS.includes(ext)) {
          if (!req.body || !req.body.folder) folder = 'homeopathy-media/attachments';
          resource_type = 'raw';
        } else if (mimetype.startsWith('image/') || ALLOWED_IMAGE_FORMATS.includes(ext)) {
          if (!req.body || !req.body.folder) folder = 'grand_mock_questions';
          resource_type = 'image';
        } else {
          if (!req.body || !req.body.folder) folder = 'homeopathy-media/attachments';
          resource_type = 'raw';
        }

        const { cleanBaseName, ext: fileExt } = extractCleanNameAndExt(file.originalname, ext);
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const isVideo = resource_type === 'video';

        const publicId = (resource_type === 'raw' && fileExt)
          ? `${cleanBaseName}-${uniqueSuffix}.${fileExt}`
          : `${cleanBaseName}-${uniqueSuffix}`;

        console.log(`[CloudinaryUpload] filename: ${file.originalname || 'unknown'}`);
        console.log(`[CloudinaryUpload] folder: ${folder}`);
        console.log(`[CloudinaryUpload] mimetype: ${mimetype || 'unknown'}`);
        console.log(`[CloudinaryUpload] bytes: ${file.buffer ? file.buffer.length : file.size || 0}`);

        try {
          const uploaded = await uploadBufferToCloudinary(file, folder, {
            resource_type,
            public_id: publicId,
            use_filename: false,
            unique_filename: false,
            timeout: isVideo ? 600000 : 120000,
            ...(isVideo ? { chunk_size: 6000000 } : {}),
          });

          if (!uploaded || !uploaded.secure_url || !uploaded.public_id || uploaded.resource_type !== resource_type || !(Number(uploaded.bytes) > 0)) {
            throw new Error('Cloudinary returned an incomplete document upload response.');
          }

          console.log(`[CloudinaryUpload] Cloudinary public_id: ${uploaded.public_id}`);
          console.log(`[CloudinaryUpload] Cloudinary secure_url: ${uploaded.secure_url}`);
          console.log(`[CloudinaryUpload] Cloudinary resource_type: ${uploaded.resource_type}`);

          file.secure_url = uploaded.secure_url;
          file.url = uploaded.secure_url;
          file.path = uploaded.secure_url;
          file.public_id = uploaded.public_id;
          file.resource_type = uploaded.resource_type;
          file.width = uploaded.width || file.width;
          file.height = uploaded.height || file.height;
          file.bytes = uploaded.bytes || file.size;
          file.format = uploaded.format || fileExt || ext;
          if (resource_type === 'raw' && (file.mimetype === 'application/pdf' || fileExt === 'pdf')) {
            file.mimetype = 'application/pdf';
            file.size = Number(uploaded.bytes) || file.buffer.length;
          }
          continue;
        } catch (uploadErr) {
          if (isVideo) {
            console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${uploadErr.message || uploadErr}`);
          }
          console.error(`[processUploadsToCloudinary Memory Buffer ERROR] File: "${file.originalname}", error:`, uploadErr.message || uploadErr);
          return res.status(500).json({
            success: false,
            message: `Failed to upload ${isVideo ? 'video' : 'media'} file to Cloudinary storage.`,
            error: uploadErr.message,
          });
        }
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

          const { cleanBaseName, ext: fileExt } = extractCleanNameAndExt(file.originalname || file.path, ext);
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          const isVideo = resource_type === 'video';

          // Cloudinary treats public_id differently based on resource_type:
          // For 'image' and 'video', Cloudinary manages extensions separately via format transformations.
          // If an extension or dot is included in public_id for a video, Cloudinary converts the dot to
          // an underscore (e.g. 'video1_mp4'). Do NOT include extension or dot in public_id for video/image.
          // For 'raw' files (PDFs, docs), Cloudinary requires the extension in public_id so the delivery URL
          // includes .pdf, preventing 404 "Resource not found" errors during downloads.
          const publicId = (resource_type === 'raw' && fileExt)
            ? `${cleanBaseName}-${uniqueSuffix}.${fileExt}`
            : `${cleanBaseName}-${uniqueSuffix}`;

          console.log(`[processUploadsToCloudinary Disk] Uploading file: "${file.originalname || file.path}", mimetype: "${mimetype}", size: ${file.size || 0} bytes, resource_type: "${resource_type}", public_id: "${publicId}"`);

          if (isVideo) {
            console.log('[VIDEO UPLOAD] File received');
            console.log(`[VIDEO UPLOAD] Filename: ${file.originalname || file.path || 'unknown'}`);
            console.log(`[VIDEO UPLOAD] MIME: ${mimetype || 'video/mp4'}`);
            console.log(`[VIDEO UPLOAD] Size: ${file.size || 0}`);
            console.log('[VIDEO UPLOAD] Starting Cloudinary upload');
          }

          const uploadDiskOptions = {
            folder,
            resource_type,
            public_id: publicId,
            use_filename: false,
            unique_filename: false,
            timeout: isVideo ? 600000 : 120000,
            ...(isVideo ? { chunk_size: 6000000 } : {}),
          };

          const uploaded = isVideo
            ? await cloudinary.uploader.upload_large(file.path, uploadDiskOptions)
            : await cloudinary.uploader.upload(file.path, uploadDiskOptions);

          if (isVideo) {
            console.log('[VIDEO UPLOAD] Cloudinary upload successful');
            console.log(`[VIDEO UPLOAD] Resource type: ${uploaded.resource_type}`);
            console.log(`[VIDEO UPLOAD] Secure URL: ${uploaded.secure_url}`);
          }

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
          if (isVideo) {
            console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${diskUploadErr.message || diskUploadErr}`);
          }
          console.error(`[processUploadsToCloudinary Disk ERROR] File: "${file.originalname || file.path}", error:`, diskUploadErr.message || diskUploadErr);
          return res.status(500).json({
            success: false,
            message: `Failed to upload ${isVideo ? 'video' : 'media'} file to Cloudinary storage.`,
            error: diskUploadErr.message,
          });
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
upload.extractCleanNameAndExt = extractCleanNameAndExt;

module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports.handleUploadError = handleUploadError;
module.exports.sanitizeFilename = sanitizeFilename;
module.exports.extractCleanNameAndExt = extractCleanNameAndExt;
