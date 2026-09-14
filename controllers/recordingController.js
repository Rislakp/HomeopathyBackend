const Recording = require('../models/Recording');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const { deleteCloudinaryByUrl } = require('../config/cloudinary');

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
 * Extract file URL from multer request object
 */
const extractFileUrl = (f) => {
  if (!f) return '';
  if (f.secure_url && f.secure_url.startsWith('http')) return f.secure_url;
  if (f.url && f.url.startsWith('http')) return f.url;
  if (f.path && f.path.startsWith('http')) return f.path;
  return f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : '');
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
  const recordedVideoUrl = (rec.recordedVideoUrl || rec.recordingFileUrl || '').trim();

  return {
    _id: rec._id,
    courseName,
    moduleName,
    lessonTitle,
    streamUrl,
    recordedVideoUrl,
    status: rec.status || 'pending',
    duration: rec.duration || '',
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
    } = req.body;

    const paramCourseId = req.params.courseId || bodyCourseId;
    const paramModuleId = req.params.moduleId || bodyModuleId;
    const paramLessonId = req.params.lessonId || bodyLessonId;

    const resolvedStreamUrl = (streamUrl || liveClassUrl || '').trim();

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

    const recording = new Recording({
      courseName: resolvedCourseName,
      moduleName: resolvedModuleName,
      lessonTitle: resolvedLessonTitle,
      streamUrl: resolvedStreamUrl,
      liveClassUrl: resolvedStreamUrl,
      duration: (duration || '').trim(),
      status: status || 'pending',
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
 * @desc    Upload recorded video file blob to Cloudinary & update recording URL + status
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
    let videoUrl = '';
    if (req.file) {
      videoUrl = extractFileUrl(req.file);
    } else if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      videoUrl = extractFileUrl(req.files[0]);
    } else if (req.body.recordedVideoUrl) {
      videoUrl = req.body.recordedVideoUrl.trim();
    } else if (req.body.recordingFileUrl) {
      videoUrl = req.body.recordingFileUrl.trim();
    } else if (req.body.videoUrl) {
      videoUrl = req.body.videoUrl.trim();
    }

    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'A video file upload or recordedVideoUrl field is required',
      });
    }

    recording.recordedVideoUrl = videoUrl;
    recording.recordingFileUrl = videoUrl;
    recording.status = req.body.status || 'stopped';
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
    console.error('Upload Recording Video Error:', error);
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
