const { deleteCloudinaryByUrl, cloudinary } = require('../config/cloudinary');

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
      
      let resourceType = file.resource_type || 'image';
      if (file.mimetype) {
        if (file.mimetype.startsWith('video/')) resourceType = 'video';
        else if (file.mimetype.startsWith('audio/')) resourceType = 'audio';
        else if (file.mimetype === 'application/pdf') resourceType = 'pdf';
        else if (!file.mimetype.startsWith('image/')) resourceType = 'raw';
      }

      return {
        public_id: publicId,
        secure_url: secureUrl,
        url: secureUrl,
        original_name: file.originalname || file.filename || 'file',
        mimetype: file.mimetype || 'application/octet-stream',
        size: file.size || 0,
        resource_type: resourceType,
      };
    });

    return res.status(200).json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
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
        public_id: item.public_id,
        secure_url: item.secure_url,
        url: item.secure_url || item.url,
        format: item.format || (item.public_id.includes('.') ? item.public_id.split('.').pop() : 'unknown'),
        resource_type: item.resource_type || 'image',
        bytes,
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
      await cloudinary.uploader.destroy(public_id, { resource_type: 'auto' });
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


