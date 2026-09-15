const Recording = require('../models/Recording');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const { deleteCloudinaryByUrl, parseCloudinaryUrl } = require('../config/cloudinary');

const findCourseByIdOrCustomId = async (id) => {
  if (!id) return null;
  return await Course.findOne({
    $or: [
      { courseId: id },
      { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
    ],
  });
};

/**
 * Helper to compute resolution quality tags and formatted string specs
 */
const calculateResolutionMetrics = (width, height, bytes, format) => {
  let resWidth = Number(width) || 0;
  let resHeight = Number(height) || 0;
  let formattedBytes = Number(bytes) || 0;

  let qualityTag = '';
  let resolutionString = '';

  if (resWidth > 0 && resHeight > 0) {
    if (resHeight >= 2160 || resWidth >= 3840) {
      qualityTag = '4K UHD';
      resolutionString = `${resWidth}x${resHeight} (4K)`;
    } else if (resHeight >= 1440 || resWidth >= 2560) {
      qualityTag = '2K QHD';
      resolutionString = `${resWidth}x${resHeight} (1440p)`;
    } else if (resHeight >= 1080 || resWidth >= 1920) {
      qualityTag = '1080p FHD';
      resolutionString = `${resWidth}x${resHeight} (1080p)`;
    } else if (resHeight >= 720 || resWidth >= 1280) {
      qualityTag = '720p HD';
      resolutionString = `${resWidth}x${resHeight} (720p)`;
    } else if (resHeight >= 480 || resWidth >= 854) {
      qualityTag = '480p SD';
      resolutionString = `${resWidth}x${resHeight} (480p)`;
    } else {
      qualityTag = `${resHeight}p`;
      resolutionString = `${resWidth}x${resHeight}`;
    }
  } else {
    // Standard default metrics fallback if dimensions omitted
    qualityTag = '1080p FHD';
    resolutionString = '1920x1080';
    resWidth = 1920;
    resHeight = 1080;
  }

  let formattedSize = '';
  if (formattedBytes > 0) {
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(formattedBytes) / Math.log(k));
    formattedSize = parseFloat((formattedBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } else {
    formattedSize = '12.5 MB';
  }

  return {
    width: resWidth,
    height: resHeight,
    bytes: formattedBytes,
    format: (format || 'mp4').toLowerCase(),
    resolution: resolutionString,
    qualityTag,
    fileSize: formattedSize,
  };
};

/**
 * Helper to sanitize video URLs: rejects restricted GCP storage links (storage.googleapis.com),
 * dummy/sample placeholder URLs, and returns clean, public HTTPS URLs (e.g. Cloudinary secure_url) or empty string.
 */
const sanitizeVideoUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();

  // Reject restricted Google Cloud Storage links, private drive links, or dummy/sample placeholder URLs
  if (
    trimmed.includes('storage.googleapis.com') ||
    trimmed.includes('storage.cloud.google.com') ||
    trimmed.includes('drive.google.com') ||
    trimmed.includes('sample-videos.com') ||
    trimmed.includes('example.com')
  ) {
    return '';
  }

  return trimmed;
};

/**
 * Extract public file URL (e.g., Cloudinary secure_url) from multer request object
 */
const extractFileUrl = (f) => {
  if (!f) return '';
  let candidate = '';
  if (f.secure_url && f.secure_url.startsWith('http')) candidate = f.secure_url;
  else if (f.url && f.url.startsWith('http')) candidate = f.url;
  else if (f.path && f.path.startsWith('http')) candidate = f.path;
  else candidate = f.secure_url || f.url || f.path || '';

  return sanitizeVideoUrl(candidate);
};

/**
 * Format a Recording document for dashboard consumption with normalized fields
 */
const formatRecordingDocument = (rec) => {
  const course = rec.courseId;
  let courseName = rec.courseName || '';
  let moduleName = rec.moduleName || '';
  let lessonTitle = rec.lessonTitle || '';
  let customCourseId = '';
  let thumbnail = '';
  let category = '';

  if (course && typeof course === 'object') {
    if (!courseName) courseName = course.courseTitle || course.title || '';
    customCourseId = course.courseId || '';
    thumbnail = course.thumbnail || '';
    category = course.category || '';

    if (Array.isArray(course.modules) && rec.moduleId) {
      const moduleObj = course.modules.id
        ? course.modules.id(rec.moduleId)
        : course.modules.find((m) => m._id && m._id.toString() === rec.moduleId.toString());
      if (moduleObj) {
        if (!moduleName) moduleName = moduleObj.moduleName;
        if (rec.lessonId) {
          const lessonObj = moduleObj.lessons && moduleObj.lessons.id
            ? moduleObj.lessons.id(rec.lessonId)
            : (moduleObj.lessons || []).find((l) => l._id && l._id.toString() === rec.lessonId.toString());
          if (lessonObj && !lessonTitle) {
            lessonTitle = lessonObj.lessonTitle;
          }
        }
      }
    }
  }

  const streamUrl = (rec.streamUrl || rec.liveClassUrl || '').trim();
  // Ensure recordedVideoUrl is strictly clean public URL or empty string "" if pending
  const recordedVideoUrl = sanitizeVideoUrl(rec.recordedVideoUrl || rec.recordingFileUrl || '');

  // Calculate resolution and quality metrics
  const metrics = calculateResolutionMetrics(
    rec.width,
    rec.height,
    rec.bytes,
    rec.format
  );

  return {
    _id: rec._id,
    courseName,
    moduleName,
    lessonTitle,
    streamUrl,
    recordedVideoUrl, // "" if pending / no video uploaded yet
    status: rec.status || 'pending',
    duration: rec.duration || '',
    width: metrics.width,
    height: metrics.height,
    bytes: metrics.bytes,
    format: metrics.format,
    resolution: rec.resolution || metrics.resolution,
    qualityTag: rec.qualityTag || metrics.qualityTag,
    fileSize: metrics.fileSize,
    // Hierarchical metadata if present
    courseId: course && course._id ? course._id : rec.courseId || null,
    customCourseId,
    thumbnail,
    category,
    moduleId: rec.moduleId || null,
    lessonId: rec.lessonId || null,
    liveClassUrl: streamUrl,
    recordingFileUrl: recordedVideoUrl,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
};

/**
 * @desc    Create a new recording session entry when a lesson with "Record" flag is created
 * @route   POST /api/recordings
 * @route   POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings
 * @access  Private/Admin
 */
exports.createRecording = async (req, res) => {
  try {
    const {
      courseName,
      moduleName,
      lessonTitle,
      streamUrl,
      liveClassUrl,
      courseId: bodyCourseId,
      moduleId: bodyModuleId,
      lessonId: bodyLessonId,
      duration,
      status,
      width,
      height,
      bytes,
      format,
    } = req.body;

    const paramCourseId = req.params.courseId || bodyCourseId;
    const paramModuleId = req.params.moduleId || bodyModuleId;
    const paramLessonId = req.params.lessonId || bodyLessonId;

    const resolvedStreamUrl = (streamUrl || liveClassUrl || '').trim();
    // Validate recorded video URL if provided in body; default to "" if pending
    const initialRecordedVideoUrl = sanitizeVideoUrl(req.body.recordedVideoUrl || req.body.recordingFileUrl || '');

    let resolvedCourseName = (courseName || '').trim();
    let resolvedModuleName = (moduleName || '').trim();
    let resolvedLessonTitle = (lessonTitle || '').trim();
    let courseDoc = null;

    if (paramCourseId) {
      courseDoc = await findCourseByIdOrCustomId(paramCourseId);
      if (courseDoc) {
        if (!resolvedCourseName) resolvedCourseName = courseDoc.courseTitle;
        if (paramModuleId && mongoose.Types.ObjectId.isValid(paramModuleId)) {
          const moduleItem = courseDoc.modules.id(paramModuleId);
          if (moduleItem) {
            if (!resolvedModuleName) resolvedModuleName = moduleItem.moduleName;
            if (paramLessonId && mongoose.Types.ObjectId.isValid(paramLessonId)) {
              const lessonItem = moduleItem.lessons.id(paramLessonId);
              if (lessonItem) {
                if (!resolvedLessonTitle) resolvedLessonTitle = lessonItem.lessonTitle;
              }
            }
          }
        }
      }
    }

    const metrics = calculateResolutionMetrics(width, height, bytes, format);

    const recording = new Recording({
      courseName: resolvedCourseName,
      moduleName: resolvedModuleName,
      lessonTitle: resolvedLessonTitle,
      streamUrl: resolvedStreamUrl,
      liveClassUrl: resolvedStreamUrl,
      recordedVideoUrl: initialRecordedVideoUrl,
      recordingFileUrl: initialRecordedVideoUrl,
      duration: (duration || '').trim(),
      status: status || 'pending',
      width: metrics.width,
      height: metrics.height,
      bytes: metrics.bytes,
      format: metrics.format,
      resolution: metrics.resolution,
      qualityTag: metrics.qualityTag,
      courseId: courseDoc ? courseDoc._id : (mongoose.Types.ObjectId.isValid(paramCourseId) ? paramCourseId : undefined),
      moduleId: mongoose.Types.ObjectId.isValid(paramModuleId) ? paramModuleId : undefined,
      lessonId: mongoose.Types.ObjectId.isValid(paramLessonId) ? paramLessonId : undefined,
    });

    await recording.save();

    return res.status(201).json({
      success: true,
      message: 'Recording session created successfully',
      data: formatRecordingDocument(recording),
    });
  } catch (error) {
    console.error('Create Recording Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create recording session',
      error: error.message,
    });
  }
};

/**
 * @desc    Fetch all recording documents to populate the Live Records dashboard view
 * @route   GET /api/recordings
 * @route   GET /api/live-records
 * @access  Public
 */
exports.getRecordings = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.courseId && mongoose.Types.ObjectId.isValid(req.query.courseId)) {
      filter.courseId = req.query.courseId;
    }

    const recordings = await Recording.find(filter)
      .populate('courseId', 'courseId courseTitle thumbnail category modules')
      .sort({ createdAt: -1 });

    const formattedList = recordings.map((rec) => formatRecordingDocument(rec));

    return res.status(200).json({
      success: true,
      count: formattedList.length,
      data: formattedList,
    });
  } catch (error) {
    console.error('Get Recordings Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recording documents',
      error: error.message,
    });
  }
};

/**
 * @desc    Fetch a single recording document by ID
 * @route   GET /api/recordings/:id
 * @access  Public
 */
exports.getRecordingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid recording ID format' });
    }

    const recording = await Recording.findById(id).populate('courseId', 'courseId courseTitle thumbnail category modules');
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording document not found' });
    }

    return res.status(200).json({
      success: true,
      data: formatRecordingDocument(recording),
    });
  } catch (error) {
    console.error('Get Recording By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recording document',
      error: error.message,
    });
  }
};

/**
 * @desc    Update real-time recording status lifecycle ('recording', 'paused', 'stopped', 'idle', 'pending', 'recorded')
 * @route   PATCH /api/recordings/:id/status
 * @access  Private/Admin
 */
exports.updateRecordingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, recordingStatus } = req.body;
    const targetStatus = (status || recordingStatus || '').toLowerCase();

    const validStatuses = ['pending', 'idle', 'recording', 'paused', 'stopped', 'recorded', 'completed'];
    if (!targetStatus || !validStatuses.includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid recording ID format' });
    }

    const recording = await Recording.findById(id);
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording document not found' });
    }

    recording.status = targetStatus;
    await recording.save();

    const populatedRec = await Recording.findById(id).populate('courseId', 'courseId courseTitle thumbnail category modules');

    return res.status(200).json({
      success: true,
      message: `Recording status updated to '${targetStatus}'`,
      data: formatRecordingDocument(populatedRec),
    });
  } catch (error) {
    console.error('Update Recording Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update recording status',
      error: error.message,
    });
  }
};

/**
 * @desc    Upload recorded video file blob to Cloudinary & update recording URL + status + specs
 * @route   POST /api/recordings/:id/upload
 * @access  Private/Admin
 */
exports.uploadRecordingVideo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid recording ID format' });
    }

    const recording = await Recording.findById(id);
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording document not found' });
    }

    // Extract Cloudinary URL from req.file or req.files or req.body
    let rawVideoUrl = '';
    if (req.file) {
      rawVideoUrl = extractFileUrl(req.file);
    } else if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      rawVideoUrl = extractFileUrl(req.files[0]);
    } else if (req.body.recordedVideoUrl) {
      rawVideoUrl = req.body.recordedVideoUrl;
    } else if (req.body.recordingFileUrl) {
      rawVideoUrl = req.body.recordingFileUrl;
    } else if (req.body.videoUrl) {
      rawVideoUrl = req.body.videoUrl;
    }

    const videoUrl = sanitizeVideoUrl(rawVideoUrl);

    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'A valid public video file upload or Cloudinary secure_url is required',
      });
    }

    // Validate that the Cloudinary URL points to a video resource (not image/raw)
    if (videoUrl.includes('cloudinary.com')) {
      const parsedInfo = parseCloudinaryUrl(videoUrl);
      if (parsedInfo && parsedInfo.resourceType && parsedInfo.resourceType !== 'video') {
        console.warn(`[uploadRecordingVideo] Cloudinary resource_type is '${parsedInfo.resourceType}', expected 'video'. URL: ${videoUrl}`);
        return res.status(400).json({
          success: false,
          message: `Uploaded file has resource_type '${parsedInfo.resourceType}' but expected 'video'. Ensure the file is uploaded with resource_type: 'video'.`,
        });
      }
    }

    // Extract Cloudinary image/video dimensions & specs if present
    const width = Number(req.file?.width || req.files?.[0]?.width || req.body.width) || 1920;
    const height = Number(req.file?.height || req.files?.[0]?.height || req.body.height) || 1080;
    const bytes = Number(req.file?.bytes || req.file?.size || req.files?.[0]?.bytes || req.files?.[0]?.size || req.body.bytes) || 0;
    const format = (req.file?.format || req.files?.[0]?.format || req.body.format || 'mp4').toLowerCase();

    const metrics = calculateResolutionMetrics(width, height, bytes, format);

    recording.recordedVideoUrl = videoUrl;
    recording.recordingFileUrl = videoUrl;
    recording.status = req.body.status || 'stopped';
    recording.width = metrics.width;
    recording.height = metrics.height;
    recording.bytes = metrics.bytes;
    recording.format = metrics.format;
    recording.resolution = metrics.resolution;
    recording.qualityTag = metrics.qualityTag;

    if (req.body.duration) {
      recording.duration = req.body.duration.trim();
    }

    await recording.save();

    // If attached to a Course lesson, sync the recorded URL into the lesson videoUrl/videoParts
    if (recording.courseId && recording.moduleId && recording.lessonId) {
      try {
        const course = await Course.findById(recording.courseId);
        if (course) {
          const moduleItem = course.modules.id(recording.moduleId);
          if (moduleItem) {
            const lessonItem = moduleItem.lessons.id(recording.lessonId);
            if (lessonItem) {
              if (!lessonItem.videoUrl) lessonItem.videoUrl = videoUrl;
              const hasPart = lessonItem.videoParts.some((p) => p.url === videoUrl);
              if (!hasPart) {
                lessonItem.videoParts.push({
                  title: `${lessonItem.lessonTitle} - Recorded Video`,
                  url: videoUrl,
                });
              }
              await course.save();
            }
          }
        }
      } catch (err) {
        console.warn('Syncing course lesson video URL failed:', err.message);
      }
    }

    const populatedRec = await Recording.findById(id).populate('courseId', 'courseId courseTitle thumbnail category modules');

    return res.status(200).json({
      success: true,
      message: 'Recorded video uploaded and attached successfully',
      data: formatRecordingDocument(populatedRec),
    });
  } catch (error) {
    console.error('========== UPLOAD RECORDING VIDEO ERROR ==========');
    console.error('MESSAGE:', error?.message);
    console.error('STACK:', error?.stack);
    console.error('==================================================');
    return res.status(500).json({
      success: false,
      message: 'Failed to upload recorded video',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete recording document from DB and remove corresponding video asset from Cloudinary storage
 * @route   DELETE /api/recordings/:id
 * @access  Private/Admin
 */
exports.deleteRecording = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid recording ID format' });
    }

    const recording = await Recording.findByIdAndDelete(id);
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording document not found' });
    }

    const targetUrl = recording.recordedVideoUrl || recording.recordingFileUrl || '';
    if (targetUrl && targetUrl.includes('cloudinary.com')) {
      await deleteCloudinaryByUrl(targetUrl);
    }

    return res.status(200).json({
      success: true,
      message: 'Recording document and video asset deleted successfully',
    });
  } catch (error) {
    console.error('Delete Recording Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete recording document',
      error: error.message,
    });
  }
};

// Backward-compatibility export aliases for legacy route files (courseRoutes.js, adminCourseRoutes.js)
exports.getLiveRecords = exports.getRecordings;
exports.uploadRecording = exports.createRecording;
exports.getLiveRecordById = exports.getRecordingById;

module.exports = {
  createRecording: exports.createRecording,
  getRecordings: exports.getRecordings,
  getRecordingById: exports.getRecordingById,
  updateRecordingStatus: exports.updateRecordingStatus,
  uploadRecordingVideo: exports.uploadRecordingVideo,
  deleteRecording: exports.deleteRecording,
  getLiveRecords: exports.getRecordings,
  uploadRecording: exports.createRecording,
  getLiveRecordById: exports.getRecordingById,
  ...exports,
};
