const s3Service = require('../services/s3Service');
const { deleteCloudinaryByUrl, parseCloudinaryUrl, cloudinary } = require('../config/cloudinary');
const https = require('https');

const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, '');
  }
  if (req && req.get && typeof req.get === 'function' && req.get('host')) {
    const protocol = req.headers && req.headers['x-forwarded-proto']
      ? req.headers['x-forwarded-proto']
      : (req.protocol || 'https');
    return `${protocol}://${req.get('host')}`;
  }
  return 'https://homeopathybackend-1.onrender.com';
};

const toAbsoluteUrl = (urlStr, req) => {
  if (typeof urlStr !== 'string') return '';
  const trimmed = urlStr.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const baseUrl = getBaseUrl(req);
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${baseUrl}${cleanPath}`;
};

/**
 * @desc    Upload multiple files/images to AWS S3 (primary) or Cloudinary (fallback)
 * @route   POST /api/upload
 * @access  Public / Protected (used by Flutter Admin Portal and client apps)
 */
exports.uploadFiles = async (req, res) => {
  try {
    const rawFiles = [];

    if (req.file) {
      rawFiles.push(req.file);
    }
    if (req.files) {
      if (Array.isArray(req.files)) {
        rawFiles.push(...req.files);
      } else {
        rawFiles.push(...Object.values(req.files).flat());
      }
    }

    if (!rawFiles.length) {
      return res.status(400).json({
        success: false,
        message: 'No files provided. Please select at least one file to upload.',
      });
    }

    const uploadedFiles = rawFiles.map((file) => {
      const storageUrl = (file.secure_url && file.secure_url.startsWith('http'))
        ? file.secure_url
        : (file.url && file.url.startsWith('http'))
          ? file.url
          : (file.fileUrl && file.fileUrl.startsWith('http'))
            ? file.fileUrl
            : (file.path && file.path.startsWith('http'))
              ? file.path
              : null;

      const rawUrl = storageUrl || (file.secure_url || file.url || file.fileUrl || file.path || (file.filename ? `/uploads/${file.filename}` : ''));
      const secureUrl = toAbsoluteUrl(rawUrl, req);
      const publicId = file.public_id || file.s3Key || file.key || file.filename || '';
      const s3Key = file.s3Key || file.key || publicId;

      let resourceType = file.resource_type || file.resourceType;
      if (!resourceType) {
        if (file.mimetype) {
          if (file.mimetype.startsWith('video/')) resourceType = 'video';
          else if (file.mimetype.startsWith('audio/')) resourceType = 'audio';
          else if (file.mimetype === 'application/pdf') resourceType = 'pdf';
          else if (file.mimetype.startsWith('image/')) resourceType = 'image';
          else resourceType = 'auto';
        } else {
          resourceType = 'auto';
        }
      }

      const originalName = (file.originalname || file.filename || 'file')
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9.\-_]/g, '');

      return {
        public_id: publicId,
        key: s3Key,
        s3Key: s3Key,
        secure_url: secureUrl,
        secureUrl: secureUrl,
        url: secureUrl,
        fileUrl: secureUrl,
        documentUrl: secureUrl,
        path: secureUrl,
        title: originalName,
        original_name: originalName,
        originalname: originalName,
        mimetype: file.mimetype === 'application/pdf' ? 'application/pdf' : (file.mimetype || 'application/octet-stream'),
        size: Number(file.bytes || file.size || 0),
        bytes: Number(file.bytes || file.size || 0),
        resource_type: resourceType,
        resourceType: resourceType,
        storageProvider: file.storageProvider || 's3',
      };
    });

    const primary = uploadedFiles[0];

    // Validate that a valid URL was produced
    if (!primary || !primary.secure_url) {
      return res.status(500).json({
        success: false,
        message: 'Upload completed without a valid file URL.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      secure_url: primary.secure_url,
      secureUrl: primary.secure_url,
      url: primary.secure_url,
      fileUrl: primary.secure_url,
      documentUrl: primary.secure_url,
      path: primary.secure_url,
      public_id: primary.public_id,
      key: primary.key,
      s3Key: primary.s3Key,
      resource_type: primary.resource_type,
      resourceType: primary.resourceType,
      storageProvider: primary.storageProvider,
      count: uploadedFiles.length,
      files: uploadedFiles,
      urls: uploadedFiles.map((f) => f.secure_url),
      data: uploadedFiles.length === 1 ? uploadedFiles[0] : uploadedFiles,
    });
  } catch (error) {
    console.error('File upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload file(s)',
      error: error.message,
    });
  }
};

/**
 * @desc    Dedicated question image upload handler for exam questions
 * @route   POST /api/upload/question-image or /api/uploads/question-image
 * @access  Public / Protected
 */
exports.uploadQuestionImage = async (req, res) => {
  try {
    const file = req.file || (req.files && (Array.isArray(req.files) ? req.files[0] : Object.values(req.files).flat()[0]));

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided for question image upload.',
      });
    }

    const mimetype = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    if (!mimetype.startsWith('image/') && !allowedMimeTypes.includes(mimetype) && !allowedExtensions.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${mimetype || ext}. Only image files (jpeg, png, webp, gif) are allowed.`,
      });
    }

    const rawUrl = file.secure_url || file.url || file.fileUrl || file.path || '';
    const secureUrl = toAbsoluteUrl(rawUrl, req);

    if (!secureUrl) {
      return res.status(500).json({
        success: false,
        message: 'Image upload completed without a valid file URL.',
      });
    }

    const publicId = file.public_id || file.s3Key || file.key || file.filename || '';
    const resourceType = file.resource_type || 'image';

    return res.status(200).json({
      success: true,
      secure_url: secureUrl,
      secureUrl: secureUrl,
      url: secureUrl,
      fileUrl: secureUrl,
      public_id: publicId,
      key: publicId,
      s3Key: file.s3Key || publicId,
      resource_type: resourceType,
    });
  } catch (error) {
    console.error('Question image upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Image upload failed',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all assets stored in media storage
 * @route   GET /api/media or GET /api/upload/media or GET /api/uploads
 * @access  Public / Protected
 */
exports.getMediaAssets = async (req, res) => {
  try {
    const { folder = 'media', resource_type = 'all', max_results = 100 } = req.query;

    const limit = Math.min(Number(max_results) || 100, 500);
    const prefix = folder === 'all' || folder === '*' ? '' : folder;

    // If Cloudinary is configured and S3 is not the only source, check Cloudinary
    if (cloudinary && typeof cloudinary.api?.resources === 'function') {
      try {
        const resourceTypesToFetch = resource_type === 'all' ? ['image', 'video', 'raw'] : [resource_type];
        const fetchPromises = resourceTypesToFetch.map(async (rType) => {
          try {
            const options = { type: 'upload', max_results: limit, resource_type: rType };
            if (prefix) options.prefix = prefix;
            const result = await cloudinary.api.resources(options);
            return (result.resources || []).map((item) => ({ ...item, resource_type: item.resource_type || rType }));
          } catch (err) {
            return [];
          }
        });

        const settled = await Promise.all(fetchPromises);
        const allResources = settled.flat();

        if (allResources.length > 0) {
          const formatted = allResources.map((item) => {
            const bytes = item.bytes || 0;
            return {
              title: item.public_id ? item.public_id.split('/').pop() : 'Resource',
              public_id: item.public_id,
              key: item.public_id,
              secure_url: item.secure_url,
              url: item.secure_url || item.url,
              format: item.format || 'unknown',
              resource_type: item.resource_type || 'image',
              bytes,
              size: bytes,
              created_at: item.created_at,
            };
          });

          return res.status(200).json({
            success: true,
            count: formatted.length,
            folder: prefix || 'all',
            resources: formatted,
            data: formatted,
          });
        }
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      count: 0,
      folder: prefix || 'all',
      resources: [],
      data: [],
    });
  } catch (error) {
    console.error('Fetch media error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch stored assets',
      error: error.message,
    });
  }
};

/**
 * Stream a document with download headers
 */
exports.downloadFile = (req, res) => {
  const sourceUrl = String(req.query.url || '').trim();
  if (!sourceUrl) {
    return res.status(400).json({ success: false, message: 'A document URL is required.' });
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch (_) {
    return res.status(400).json({ success: false, message: 'Invalid document URL.' });
  }

  const requestedName = String(req.query.filename || '').trim();
  const urlName = decodeURIComponent(parsed.pathname.split('/').pop() || 'document.pdf');
  const filename = (requestedName || urlName).replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', /\.pdf$/i.test(filename) ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Direct streaming proxy
  const request = https.get(parsed, (upstream) => {
    if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      return upstream.pipe(res);
    }
    if (!res.headersSent) res.status(upstream.statusCode || 502);
    return res.end();
  });

  request.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ success: false, message: 'Failed to download document.', error: err.message });
  });
};

/**
 * @desc    Delete a file from AWS S3 or Cloudinary by URL, key, or public_id
 * @route   DELETE /api/upload
 * @access  Private / Protected
 */
exports.deleteFile = async (req, res) => {
  try {
    const { url, key, s3Key, public_id } = req.body;
    const target = url || key || s3Key || public_id;

    if (!target) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a url, key, or public_id to delete',
      });
    }

    // Check if it's an S3 target (S3 URL, s3Key, key, or contains amazonaws.com)
    const isS3Target = key || s3Key || (typeof target === 'string' && (target.includes('amazonaws.com') || (s3Service.getS3KeyFromUrl(target) !== null && !target.includes('cloudinary.com'))));

    if (isS3Target && s3Service.isS3Configured()) {
      try {
        await s3Service.deleteFile(target);
        return res.status(200).json({
          success: true,
          message: 'File deleted from S3 successfully',
        });
      } catch (s3Err) {
        console.warn('S3 deletion warning:', s3Err.message);
      }
    }

    // Cloudinary fallback or legacy URL deletion
    if (url && url.includes('cloudinary.com')) {
      await deleteCloudinaryByUrl(url);
    } else if (public_id && cloudinary && cloudinary.uploader) {
      const rType = req.body.resource_type || 'image';
      await cloudinary.uploader.destroy(public_id, { resource_type: rType }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('Delete file error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error.message,
    });
  }
};

/**
 * @desc    Generate signed parameters for direct video uploads
 * @route   POST /api/upload/video/signature or /api/uploads/video/signature
 * @access  Private (Admin / SuperAdmin / Authorized Staff)
 */
exports.generateVideoSignature = async (req, res) => {
  try {
    const config = cloudinary.config();
    const cloudName = config.cloud_name || process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = config.api_key || process.env.CLOUDINARY_API_KEY;
    const apiSecret = config.api_secret || process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary configuration is incomplete on the server.',
      });
    }

    const timestamp = req.body && req.body.timestamp
      ? Number(req.body.timestamp)
      : Math.round(Date.now() / 1000);
    const folder = (req.body && req.body.folder ? req.body.folder : 'homeopathy-media/videos').trim();

    const paramsToSign = {
      folder: folder,
      timestamp: timestamp,
    };

    if (req.body && (req.body.public_id || req.body.publicId)) {
      paramsToSign.public_id = String(req.body.public_id || req.body.publicId).trim();
    }

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;

    return res.status(200).json({
      success: true,
      data: {
        timestamp,
        signature,
        apiKey,
        api_key: apiKey,
        cloudName,
        cloud_name: cloudName,
        folder,
        resourceType: 'video',
        resource_type: 'video',
        uploadUrl,
        upload_url: uploadUrl,
        public_id: paramsToSign.public_id || null,
        publicId: paramsToSign.public_id || null,
        chunkSize: 6000000,
        chunk_size: 6000000,
      },
    });
  } catch (error) {
    console.error('Generate video signature error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate video upload signature',
      error: error.message,
    });
  }
};

/**
 * @desc    Dedicated cleanup endpoint for video uploads
 * @route   DELETE /api/upload/video or /api/uploads/video
 * @access  Private (Admin / SuperAdmin)
 */
exports.deleteVideo = async (req, res) => {
  try {
    const { url, key, s3Key, public_id, publicId } = req.body;
    const targetKey = key || s3Key || public_id || publicId;

    if (!url && !targetKey) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either url or key to delete video',
      });
    }

    if (s3Service.isS3Configured() && (targetKey || (url && url.includes('amazonaws.com')))) {
      await s3Service.deleteFile(url || targetKey).catch(() => {});
    } else if (url && url.includes('cloudinary.com')) {
      await deleteCloudinaryByUrl(url).catch(() => {});
    } else if (targetKey && cloudinary.uploader) {
      await cloudinary.uploader.destroy(targetKey, { resource_type: 'video' }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Video deleted successfully',
    });
  } catch (error) {
    console.error('Delete video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete video',
      error: error.message,
    });
  }
};
