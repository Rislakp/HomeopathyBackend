const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require('../config/cloudinary');

// Ensure uploads directory exists for optional fallback when Cloudinary is not configured.
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Disk storage configuration for the local fallback path.
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// File filter (PDFs, Documents, Images, Videos, Audios)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|jpeg|png|webp|gif|mp4|avi|mov|mkv|flv|wmv|mp3|wav|ogg/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowedExtensions.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} is not allowed`));
  }
};

const upload = multer({
  storage: isCloudinaryConfigured() ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter,
});

const processUploadsToCloudinary = async (req, res, next) => {
  if (!isCloudinaryConfigured()) {
    return next();
  }

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
      if (!file || !file.buffer) {
        continue;
      }

      const uploaded = await uploadBufferToCloudinary(file, 'homeopathy-media');
      file.path = uploaded.secure_url;
      file.url = uploaded.secure_url;
      file.secure_url = uploaded.secure_url;
      file.public_id = uploaded.public_id;
      file.resource_type = uploaded.resource_type;
    }

    return next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: 'Cloudinary upload failed',
      error: error.message,
    });
  }
};

upload.processUploadsToCloudinary = processUploadsToCloudinary;
module.exports = upload;
module.exports.processUploadsToCloudinary = processUploadsToCloudinary;
