const multer = require('multer');
const path = require('path');
const { processUploadsToCloudinary } = require('./upload');

const ALLOWED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB limit

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
  const mime = (file.mimetype || '').toLowerCase();

  const isMimeImage = mime.startsWith('image/') && ['jpeg', 'jpg', 'png', 'webp'].some(f => mime.includes(f));
  const isExtImage = ALLOWED_IMAGE_FORMATS.includes(ext);

  if ((ext && isExtImage) || isMimeImage) {
    cb(null, true);
  } else {
    const err = new Error('Invalid image format. Allowed formats: jpg, jpeg, png, webp');
    err.statusCode = 400;
    cb(err, false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE,
  },
  fileFilter,
});

/**
 * Express middleware wrapper handling single field 'image' upload,
 * file validation, 10MB limit handling, and Cloudinary upload processing.
 */
const handleRankImageUpload = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: 'Image file size exceeds the allowed limit (10MB).',
        });
      }

      const statusCode = err.statusCode || 400;
      return res.status(statusCode).json({
        success: false,
        message: err.message || 'Invalid image file upload.',
      });
    }

    // Process file to Cloudinary if file exists
    return processUploadsToCloudinary(req, res, next);
  });
};

module.exports = {
  handleRankImageUpload,
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_SIZE,
};
