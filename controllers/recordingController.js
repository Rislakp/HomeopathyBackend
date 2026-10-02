const Recording = require('../models/Recording');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const s3Service = require('../services/s3Service');
const {
  isCloudinaryConfigured,
  deleteCloudinaryByUrl,
  uploadBufferToCloudinary,
} = require('../config/cloudinary');
const { verifyStudentCourseAccess } = require('../utils/courseAccessHelper');
const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');
const { normalizeS3Reference, signS3Reference } = require('../utils/s3MediaSigner');

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
const formatRecordingDocument = async (rec) => {
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
  const storedVideoUrl = sanitizeVideoUrl(rec.recordedVideoUrl || rec.recordingFileUrl || '');
  const s3RefCandidate = (rec.storageProvider === 's3' && rec.s3Key)
    ? { storageProvider: 's3', s3Key: rec.s3Key, contentType: 'video/mp4' }
    : storedVideoUrl;
  const s3VideoReference = normalizeS3Reference(s3RefCandidate);
  const signedResult = s3VideoReference
    ? await signS3Reference(s3VideoReference, s3VideoReference.contentType)
    : null;
  const recordedVideoUrl = signedResult?.url || storedVideoUrl;

  // Calculate resolution and quality metrics
  const metrics = calculateResolutionMetrics(
    rec.width,
    rec.height,
    rec.bytes,
    rec.format
  );

  const resolvedS3Key = rec.s3Key || s3VideoReference?.s3Key || s3Service.getS3KeyFromUrl(storedVideoUrl) || '';
  const storageProvider = rec.storageProvider || (resolvedS3Key ? 's3' : (storedVideoUrl.includes('cloudinary.com') ? 'cloudinary' : ''));

  return {
    _id: rec._id,
    courseName,
    moduleName,
    lessonTitle,
    streamUrl,
    recordedVideoUrl, // "" if pending / signed S3 URL or Cloudinary URL
    recordingFileUrl: recordedVideoUrl,
    videoUrl: recordedVideoUrl,
    url: recordedVideoUrl,
    secure_url: recordedVideoUrl,
    secureUrl: recordedVideoUrl,
    fileUrl: recordedVideoUrl,
    mediaUrl: recordedVideoUrl,
    s3Key: resolvedS3Key,
    key: resolvedS3Key,
    public_id: resolvedS3Key || (rec._id ? rec._id.toString() : ''),
    storageProvider,
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
    // Validate recorded video URL if provided in body or file; default to "" if pending
    const uploadedFile = req.file || (Array.isArray(req.files) ? req.files[0] : (req.uploadedFiles ? req.uploadedFiles[0] : null));
    const initialRecordedVideoUrl = sanitizeVideoUrl(
      extractFileUrl(uploadedFile) || req.body.recordedVideoUrl || req.body.recordingFileUrl || req.body.videoUrl || req.body.secure_url || ''
    );
    const initialS3Key = req.body.s3Key || req.body.key || (uploadedFile?.s3Key) || (uploadedFile?.key) || s3Service.getS3KeyFromUrl(initialRecordedVideoUrl) || '';
    const initialStorageProvider = req.body.storageProvider || (uploadedFile?.storageProvider) || (initialS3Key ? 's3' : (initialRecordedVideoUrl.includes('cloudinary.com') ? 'cloudinary' : ''));

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
      s3Key: initialS3Key,
      storageProvider: initialStorageProvider,
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

    const formattedRecording = await formatRecordingDocument(recording);
    const activeVideoUrl = formattedRecording.recordedVideoUrl || initialRecordedVideoUrl;
    const finalKey = recording.s3Key || formattedRecording.s3Key || '';
    const publicId = finalKey || (recording._id ? recording._id.toString() : '');

    return res.status(201).json({
      success: true,
      message: 'Recording session created successfully',
      secure_url: activeVideoUrl,
      secureUrl: activeVideoUrl,
      url: activeVideoUrl,
      videoUrl: activeVideoUrl,
      fileUrl: activeVideoUrl,
      mediaUrl: activeVideoUrl,
      recordedVideoUrl: activeVideoUrl,
      recordingFileUrl: activeVideoUrl,
      public_id: publicId,
      key: finalKey,
      s3Key: finalKey,
      storageProvider: recording.storageProvider || 's3',
      data: formattedRecording,
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
    const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');

    let page, limit, skip;
    try {
      const parsed = parsePaginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
      page = parsed.page;
      limit = parsed.limit;
      skip = parsed.skip;
    } catch (pagErr) {
      return res.status(pagErr.statusCode || 400).json({
        success: false,
        message: pagErr.message,
      });
    }

    const filter = {};
    const query = req ? (req.query || {}) : {};
    if (query.status && query.status.toLowerCase() !== 'all') {
      filter.status = new RegExp(`^${query.status.trim()}$`, 'i');
    }
    if (query.courseId && mongoose.Types.ObjectId.isValid(query.courseId)) {
      filter.courseId = query.courseId;
    }
    if (query.search && typeof query.search === 'string' && query.search.trim()) {
      const searchStr = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(searchStr, 'i');
      filter.$or = [
        { lessonTitle: searchRegex },
        { courseName: searchRegex },
        { moduleName: searchRegex },
      ];
    }

    // Add student authorization filter
    const isStaff = ['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase());
    if (req.user && !isStaff) {
      const studentCourseRef = req.user.courseRef;
      const studentCourseId = req.user.courseId;
      const studentCourseTitle = req.user.course;

      if (!studentCourseRef && !studentCourseId && !studentCourseTitle) {
        return res.status(200).json({
          success: true,
          message: 'Registered course could not be loaded or is not assigned to student profile.',
          data: [],
          recordings: [],
          count: 0,
          pagination: buildPaginationResponse(0, page, limit),
        });
      }

      const courseOrFilter = [];
      if (studentCourseRef && mongoose.Types.ObjectId.isValid(studentCourseRef)) {
        courseOrFilter.push({ courseId: new mongoose.Types.ObjectId(studentCourseRef) });
      }
      if (studentCourseId) {
        courseOrFilter.push({ courseId: studentCourseId });
      }
      if (studentCourseTitle) {
        courseOrFilter.push({ courseName: studentCourseTitle });
      }

      if (courseOrFilter.length > 0) {
        filter.$and = filter.$or ? [{ $or: filter.$or }, { $or: courseOrFilter }] : courseOrFilter;
        delete filter.$or;
      } else {
        return res.status(200).json({
          success: true,
          count: 0,
          data: [],
          recordings: [],
          pagination: buildPaginationResponse(0, page, limit),
        });
      }
    }

    const [total, recordings] = await Promise.all([
      Recording.countDocuments(filter),
      Recording.find(filter)
        .select('_id courseId moduleId lessonId courseName moduleName lessonTitle streamUrl recordedVideoUrl liveClassUrl recordingFileUrl duration status width height bytes format resolution qualityTag s3Key storageProvider createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const formattedList = await Promise.all(recordings.map((rec) => formatRecordingDocument(rec)));
    const pagination = buildPaginationResponse(total, page, limit);

    return res.status(200).json({
      success: true,
      data: formattedList,
      pagination,
      count: formattedList.length,
      total: pagination.total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: pagination.totalPages,
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

    const query = Recording.findById(id);
    const recording = (query && typeof query.populate === 'function')
      ? await query.populate('courseId', 'courseId courseTitle thumbnail category modules')
      : await query;
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording document not found' });
    }

    // Add student authorization filter
    if (req.user && req.user.role === 'student') {
      const Student = require('../models/Student');
      const student = await Student.findOne({ userId: req.user.id }) || await Student.findById(req.user.id);
      
      if (!student) {
        return res.status(403).json({ success: false, message: 'Student profile not found.' });
      }
      if (student.accountStatus !== 'Approved' && student.status !== 'Active') {
        return res.status(403).json({ success: false, message: 'Account is not active or approved.' });
      }
      
      const recordingCourseId = recording.courseId && typeof recording.courseId === 'object' 
        ? recording.courseId._id.toString() 
        : (recording.courseId || '').toString();
      
      const hasAccess = await verifyStudentCourseAccess(req.user, recordingCourseId);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'You are not authorized to access this live class.' });
      }
    }

    return res.status(200).json({
      success: true,
      data: await formatRecordingDocument(recording),
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

    const popQuery = Recording.findById(id);
    const populatedRec = (popQuery && typeof popQuery.populate === 'function')
      ? await popQuery.populate('courseId', 'courseId courseTitle thumbnail category modules')
      : (await popQuery || recording);

    return res.status(200).json({
      success: true,
      message: `Recording status updated to '${targetStatus}'`,
      data: await formatRecordingDocument(populatedRec),
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

    const uploadedFile = req.file || (Array.isArray(req.files) ? req.files[0] : (req.uploadedFiles ? req.uploadedFiles[0] : null));
    const directUrl = sanitizeVideoUrl(req.body.secure_url || req.body.videoUrl || req.body.url || req.body.recordedVideoUrl || req.body.recordingFileUrl || '');

    if (!uploadedFile && !directUrl) {
      return res.status(400).json({
        success: false,
        message: 'A non-empty video file upload or video URL is required',
      });
    }

    let secureUrl = '';
    let uploaded = {};

    if (uploadedFile) {
      if (s3Service.isS3Configured()) {
        uploaded = await s3Service.uploadFile(uploadedFile, 'videos', {
          originalname: uploadedFile.originalname || `recording-${id}.mp4`,
          mimetype: uploadedFile.mimetype || 'video/mp4',
        });
        secureUrl = sanitizeVideoUrl(uploaded.secure_url || uploaded.url);
      } else if (isCloudinaryConfigured()) {
        uploaded = await uploadBufferToCloudinary(
          uploadedFile,
          'live_records',
          { resource_type: 'video' }
        );
        secureUrl = sanitizeVideoUrl(uploaded.secure_url);
      } else {
        throw new Error('Neither AWS S3 nor Cloudinary is configured for recording storage.');
      }
    } else {
      secureUrl = directUrl;
      const key = req.body.s3Key || req.body.key || s3Service.getS3KeyFromUrl(directUrl) || '';
      uploaded = {
        secure_url: directUrl,
        url: directUrl,
        s3Key: key,
        key: key,
        storageProvider: req.body.storageProvider || (key ? 's3' : (directUrl.includes('cloudinary.com') ? 'cloudinary' : '')),
      };
    }

    if (!secureUrl) {
      throw new Error('Storage service did not return a valid HTTPS media URL.');
    }
    
    // Save to req for potential cleanup in catch block
    req.uploadedSecureUrl = secureUrl;

    const resolvedKey = uploaded.s3Key || uploaded.key || s3Service.getS3KeyFromUrl(secureUrl) || '';
    const activeStorageProvider = uploaded.storageProvider || (resolvedKey ? 's3' : (secureUrl.includes('cloudinary.com') ? 'cloudinary' : ''));

    // Extract image/video dimensions & specs if present
    const width = Number(uploaded.width || req.body.width) || 1920;
    const height = Number(uploaded.height || req.body.height) || 1080;
    const bytes = Number(uploaded.bytes || (uploadedFile?.buffer ? uploadedFile.buffer.length : 0)) || 0;
    const format = (uploaded.format || req.body.format || 'mp4').toLowerCase();

    const metrics = calculateResolutionMetrics(width, height, bytes, format);

    recording.recordedVideoUrl = secureUrl;
    recording.recordingFileUrl = secureUrl;
    recording.s3Key = resolvedKey;
    recording.storageProvider = activeStorageProvider;
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
              if (!lessonItem.videoUrl) lessonItem.videoUrl = secureUrl;
              const s3Reference = normalizeS3Reference(uploaded);
              const videoPart = s3Reference || {
                title: `${lessonItem.lessonTitle} - Recorded Video`,
                url: secureUrl,
                secure_url: secureUrl,
              };
              const hasPart = lessonItem.videoParts.some((part) => (
                (s3Reference && part.s3Key === s3Reference.s3Key) || part.url === secureUrl
              ));
              if (!hasPart) {
                lessonItem.videoParts.push({
                  ...videoPart,
                  title: videoPart.title || `${lessonItem.lessonTitle} - Recorded Video`,
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

    const query = Recording.findById(id);
    const populatedRec = (query && typeof query.populate === 'function')
      ? await query.populate('courseId', 'courseId courseTitle thumbnail category modules')
      : (await query || recording);
    const formattedRecording = await formatRecordingDocument(populatedRec || recording);

    const activeVideoUrl = formattedRecording.recordedVideoUrl || secureUrl;
    const finalKey = recording.s3Key || resolvedKey;
    const publicId = finalKey || uploaded.public_id || (recording._id ? recording._id.toString() : id);

    return res.status(200).json({
      success: true,
      message: 'Recording uploaded successfully',
      secure_url: activeVideoUrl,
      secureUrl: activeVideoUrl,
      url: activeVideoUrl,
      videoUrl: activeVideoUrl,
      fileUrl: activeVideoUrl,
      mediaUrl: activeVideoUrl,
      recordedVideoUrl: activeVideoUrl,
      recordingFileUrl: activeVideoUrl,
      public_id: publicId,
      key: finalKey,
      s3Key: finalKey,
      storageProvider: activeStorageProvider,
      bytes: metrics.bytes,
      data: formattedRecording,
    });
  } catch (error) {
    if (req.uploadedSecureUrl) {
      if (req.uploadedSecureUrl.includes('cloudinary.com')) {
        deleteCloudinaryByUrl(req.uploadedSecureUrl).catch(err => console.error('Failed to cleanup recording video on save failure:', err));
      } else if (s3Service.isS3Configured()) {
        s3Service.deleteFile(req.uploadedSecureUrl).catch(err => console.error('Failed to cleanup S3 recording video:', err));
      }
    }
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
 * @desc    Delete recording document from DB and remove corresponding video asset from storage
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
    if (targetUrl) {
      if (targetUrl.includes('cloudinary.com')) {
        await deleteCloudinaryByUrl(targetUrl).catch(() => {});
      } else if (s3Service.isS3Configured() || targetUrl.includes('amazonaws.com')) {
        await s3Service.deleteFile(targetUrl).catch(() => {});
      }
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
