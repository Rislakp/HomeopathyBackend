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
 * @desc    Upload multiple files/images to Cloudinary
 * @route   POST /api/upload
 * @access  Public / Protected (can be used by admin and authorized clients)
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
      const cloudUrl = (file.secure_url && file.secure_url.startsWith('http'))
        ? file.secure_url
        : (file.url && file.url.startsWith('http'))
          ? file.url
          : (file.path && file.path.startsWith('http'))
            ? file.path
            : null;

      const rawUrl = cloudUrl || (file.secure_url || file.url || file.path || (file.filename ? `/uploads/${file.filename}` : ''));
      const secureUrl = toAbsoluteUrl(rawUrl, req);
      const publicId = file.public_id || file.filename || '';
      
      let resourceType = file.resource_type;
      if (!resourceType) {
        if (file.mimetype) {
          if (file.mimetype.startsWith('video/')) resourceType = 'video';
          else if (file.mimetype.startsWith('audio/')) resourceType = 'audio';
          else if (file.mimetype === 'application/pdf') resourceType = 'auto';
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
        secure_url: secureUrl,
        url: secureUrl,
        fileUrl: secureUrl,
        documentUrl: secureUrl,
        path: secureUrl,
        title: originalName,
        original_name: originalName,
        mimetype: file.mimetype === 'application/pdf' ? 'application/pdf' : (file.mimetype || 'application/octet-stream'),
        size: Number(file.bytes || file.size || 0),
        resource_type: resourceType,
      };
    });

    const primary = uploadedFiles[0];

    // Validate that Cloudinary produced a valid secure_url
    if (!primary || !primary.secure_url) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary upload completed without secure_url',
      });
    }

    return res.status(200).json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      secure_url: primary.secure_url,
      url: primary.secure_url,
      fileUrl: primary.secure_url,
      documentUrl: primary.secure_url,
      path: primary.secure_url,
      public_id: primary.public_id,
      resource_type: primary.resource_type,
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

    const rawUrl = file.secure_url || file.url || file.path || '';
    const secureUrl = toAbsoluteUrl(rawUrl, req);

    if (!secureUrl) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary upload completed without secure_url',
      });
    }

    const publicId = file.public_id || file.filename || '';
    const resourceType = file.resource_type || 'image';

    return res.status(200).json({
      success: true,
      secure_url: secureUrl,
      url: secureUrl,
      public_id: publicId,
      resource_type: resourceType,
    });
  } catch (error) {
    console.error('Question image upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Cloudinary image upload failed',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all assets stored in Cloudinary storage (e.g. folder 'homeopathy-media')
 * @route   GET /api/media or GET /api/upload/media or GET /api/uploads
 * @access  Public / Protected
 */
exports.getMediaAssets = async (req, res) => {
  try {
    const { folder = 'homeopathy-media', resource_type = 'all', max_results = 100 } = req.query;

    const limit = Math.min(Number(max_results) || 100, 500);
    const prefix = folder === 'all' || folder === '*' ? '' : folder;

    const resourceTypesToFetch = [];
    if (resource_type === 'all') {
      resourceTypesToFetch.push('image', 'video', 'raw');
    } else {
      resourceTypesToFetch.push(resource_type);
    }

    // Query Cloudinary Admin API across specified resource types
    const fetchPromises = resourceTypesToFetch.map(async (rType) => {
      try {
        const options = {
          type: 'upload',
          max_results: limit,
          resource_type: rType,
        };
        if (prefix) {
          options.prefix = prefix;
        }
        const result = await cloudinary.api.resources(options);
        return (result.resources || []).map((item) => ({
          ...item,
          resource_type: item.resource_type || rType,
        }));
      } catch (err) {
        // If prefix not found or empty for this resource type, return empty array gracefully
        return [];
      }
    });

    const settled = await Promise.all(fetchPromises);
    const allResources = settled.flat();

    // If prefix had 0 results and folder was default 'homeopathy-media', also fetch root/recent assets so user can see samples if folder is still fresh
    let finalResources = allResources;
    if (finalResources.length === 0 && prefix && req.query.fallback !== 'false') {
      try {
        const fallbackRes = await cloudinary.api.resources({
          type: 'upload',
          max_results: 30,
          resource_type: 'image',
        });
        if (fallbackRes.resources && fallbackRes.resources.length > 0) {
          finalResources = fallbackRes.resources;
        }
      } catch (_) {}
    }

    // Sort by created_at descending
    finalResources.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const formatted = finalResources.map((item) => {
      const bytes = item.bytes || 0;
      let sizeFormatted = `${bytes} B`;
      if (bytes >= 1024 * 1024) sizeFormatted = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      else if (bytes >= 1024) sizeFormatted = `${(bytes / 1024).toFixed(1)} KB`;

      return {
        title: item.public_id ? item.public_id.split('/').pop() : 'Resource',
        public_id: item.public_id,
        secure_url: item.secure_url,
        url: item.secure_url || item.url,
        format: item.format || (item.public_id.includes('.') ? item.public_id.split('.').pop() : 'unknown'),
        resource_type: item.resource_type || 'image',
        mimetype: (item.format === 'pdf' || /\.pdf$/i.test(item.public_id || ''))
          ? 'application/pdf'
          : (item.resource_type === 'image' ? `image/${item.format || 'jpeg'}` : ''),
        bytes,
        size: bytes,
        size_formatted: sizeFormatted,
        width: item.width || null,
        height: item.height || null,
        created_at: item.created_at,
      };
    });

    const totalBytes = formatted.reduce((acc, curr) => acc + curr.bytes, 0);

    return res.status(200).json({
      success: true,
      count: formatted.length,
      folder: prefix || 'all',
      total_bytes: totalBytes,
      total_size_formatted: `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`,
      resources: formatted,
      data: formatted,
    });
  } catch (error) {
    console.error('Fetch Cloudinary media error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch stored assets from Cloudinary',
      error: error.message,
    });
  }
};

/**
 * Stream a Cloudinary document with download headers without transforming bytes.
 * The preview URL remains the original Cloudinary secure_url.
 */
exports.downloadFile = (req, res) => {
  const sourceUrl = String(req.query.url || '').trim();
  if (!sourceUrl) {
    return res.status(400).json({ success: false, message: 'A Cloudinary document URL is required.' });
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch (_) {
    return res.status(400).json({ success: false, message: 'Invalid document URL.' });
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.cloudinary.com')) {
    return res.status(400).json({ success: false, message: 'Only Cloudinary document URLs are supported.' });
  }

  const requestedName = String(req.query.filename || '').trim();
  const urlName = decodeURIComponent(parsed.pathname.split('/').pop() || 'document.pdf');
  const filename = (requestedName || urlName).replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', /\.pdf$/i.test(filename) ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const streamFromSignedUrl = () => {
    try {
      const parsedInfo = parseCloudinaryUrl(sourceUrl);
      if (parsedInfo && parsedInfo.publicId) {
        const ext = path.extname(filename).replace('.', '') || 'pdf';
        const privUrl = cloudinary.utils.private_download_url(parsedInfo.publicId, ext, {
          resource_type: parsedInfo.resourceType || 'image',
          type: 'upload',
        });
        const privParsed = new URL(privUrl);
        const signedReq = https.get(privParsed, (privStream) => {
          if (privStream.statusCode >= 200 && privStream.statusCode < 300) {
            if (privStream.headers['content-length']) res.setHeader('Content-Length', privStream.headers['content-length']);
            return privStream.pipe(res);
          }
          privStream.resume();
          if (!res.headersSent) res.status(privStream.statusCode || 502).end();
        });
        signedReq.on('error', (err) => {
          if (!res.headersSent) res.status(502).json({ success: false, message: 'Failed to download document.', error: err.message });
        });
        return;
      }
    } catch (_) {}
    if (!res.headersSent) res.status(502).end();
  };

  const request = https.get(parsed, (upstream) => {
    if (upstream.statusCode === 401 || upstream.statusCode === 403) {
      upstream.resume();
      return streamFromSignedUrl();
    }
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      upstream.resume();
      if (!res.headersSent) res.status(upstream.statusCode || 502);
      return res.end();
    }
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    upstream.pipe(res);
  });
  request.on('error', () => {
    streamFromSignedUrl();
  });
};

/**
 * @desc    Delete a file from Cloudinary by URL or public_id
 * @route   DELETE /api/upload
 * @access  Private / Protected
 */
exports.deleteFile = async (req, res) => {
  try {
    const { url, public_id } = req.body;

    if (!url && !public_id) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a url or public_id to delete',
      });
    }

    if (url) {
      await deleteCloudinaryByUrl(url);
    } else if (public_id) {
      const rType = req.body.resource_type || 'image';
      let resDelete = await cloudinary.uploader.destroy(public_id, { resource_type: rType });
      if (resDelete.result !== 'ok' && !req.body.resource_type) {
        // Fallback for public_id deletion without resource_type
        for (const fallbackType of ['video', 'raw', 'image']) {
          if (fallbackType !== rType) {
            resDelete = await cloudinary.uploader.destroy(public_id, { resource_type: fallbackType });
            if (resDelete.result === 'ok') break;
          }
        }
      }
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
 * @desc    Generate signed parameters for direct frontend upload to Cloudinary (Video)
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

    const timestamp = Math.round(Date.now() / 1000);
    const folder = (req.body.folder || 'homeopathy-media/videos').trim();

    const paramsToSign = {
      timestamp: timestamp,
      folder: folder,
    };

    if (req.body.public_id || req.body.publicId) {
      paramsToSign.public_id = String(req.body.public_id || req.body.publicId).trim();
    }

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;

    return res.status(200).json({
      success: true,
      data: {
        timestamp: timestamp,
        signature: signature,
        apiKey: apiKey,
        cloudName: cloudName,
        folder: folder,
        resourceType: 'video',
        uploadUrl: uploadUrl,
        public_id: paramsToSign.public_id || null,
      },
    });
  } catch (error) {
    console.error('Generate video signature error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate video upload signature',
      error: error.message,
    });
  }
};

/**
 * @desc    Dedicated cleanup endpoint for video uploads if lesson creation fails
 * @route   DELETE /api/upload/video or /api/uploads/video
 * @access  Private (Admin / SuperAdmin)
 */
exports.deleteVideo = async (req, res) => {
  try {
    const { url, public_id, publicId } = req.body;
    const targetPublicId = public_id || publicId;

    if (!url && !targetPublicId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either url or public_id to delete video',
      });
    }

    if (url) {
      await deleteCloudinaryByUrl(url);
    } else if (targetPublicId) {
      await cloudinary.uploader.destroy(targetPublicId, { resource_type: 'video' });
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



