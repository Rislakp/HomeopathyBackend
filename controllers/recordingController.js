const Recording = require('../models/Recording');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const { deleteCloudinaryByUrl } = require('../config/cloudinary');

const findCourseByIdOrCustomId = async (id) => {
  return await Course.findOne({
    $or: [
      { courseId: id },
      { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
    ],
  });
};

/**
 * @desc    Upload live session recording video blob & associate with lesson
 * @route   POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/recordings
 * @access  Private/Admin
 */
exports.uploadRecording = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;
    const { liveClassUrl, duration, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(moduleId) || !mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid module or lesson ID format',
      });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const lessonItem = moduleItem.lessons.id(lessonId);
    if (!lessonItem) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Resolve uploaded file or body URL
    let recordingFileUrl = '';
    const extractFileUrl = (f) => {
      if (!f) return '';
      if (f.secure_url && f.secure_url.startsWith('http')) return f.secure_url;
      if (f.url && f.url.startsWith('http')) return f.url;
      if (f.path && f.path.startsWith('http')) return f.path;
      return f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : '');
    };

    if (req.file) {
      recordingFileUrl = extractFileUrl(req.file);
    } else if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      recordingFileUrl = extractFileUrl(req.files[0]);
    } else if (req.body.recordingFileUrl) {
      recordingFileUrl = req.body.recordingFileUrl.trim();
    } else if (req.body.videoUrl) {
      recordingFileUrl = req.body.videoUrl.trim();
    }

    if (!recordingFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'A recording video file upload or recordingFileUrl is required',
      });
    }

    const resolvedLiveUrl = (liveClassUrl || lessonItem.meetingUrl || lessonItem.videoUrl || '').trim();
    if (!resolvedLiveUrl) {
      return res.status(400).json({
        success: false,
        message: 'liveClassUrl is required when not configured on the lesson',
      });
    }

    // Also link recording into the lesson's videoUrl/videoParts if not already present
    if (!lessonItem.videoUrl) {
      lessonItem.videoUrl = recordingFileUrl;
    }
    const hasPart = lessonItem.videoParts.some((p) => p.url === recordingFileUrl);
    if (!hasPart) {
      lessonItem.videoParts.push({
        title: `${lessonItem.lessonTitle} - Live Recording`,
        url: recordingFileUrl,
      });
    }
    await course.save();

    // Create or update Recording document
    const recording = await Recording.findOneAndUpdate(
      { courseId: course._id, moduleId, lessonId },
      {
        courseId: course._id,
        moduleId,
        lessonId,
        liveClassUrl: resolvedLiveUrl,
        recordingFileUrl,
        duration: (duration || lessonItem.durationOrPages || '').trim(),
        status: status || 'Completed',
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      success: true,
      message: 'Recording uploaded and attached successfully',
      data: recording,
    });
  } catch (error) {
    console.error('Upload Recording Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload recording',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all live session records with populated hierarchical metadata
 * @route   GET /api/live-records
 * @access  Public
 */
exports.getLiveRecords = async (req, res) => {
  try {
    const recordings = await Recording.find()
      .populate('courseId', 'courseId courseTitle thumbnail category modules')
      .sort({ createdAt: -1 });

    const populatedRecords = recordings.map((rec) => {
      const course = rec.courseId;
      let moduleName = 'Unknown Module';
      let lessonTitle = 'Unknown Lesson';

      if (course && Array.isArray(course.modules)) {
        const moduleObj = course.modules.id(rec.moduleId);
        if (moduleObj) {
          moduleName = moduleObj.moduleName;
          const lessonObj = moduleObj.lessons.id(rec.lessonId);
          if (lessonObj) {
            lessonTitle = lessonObj.lessonTitle;
          }
        }
      }

      return {
        _id: rec._id,
        courseId: course ? course._id : rec.courseId,
        customCourseId: course ? course.courseId : '',
        courseTitle: course ? course.courseTitle : 'Unknown Course',
        thumbnail: course ? course.thumbnail : '',
        category: course ? course.category : '',
        moduleId: rec.moduleId,
        moduleName,
        lessonId: rec.lessonId,
        lessonTitle,
        liveClassUrl: rec.liveClassUrl,
        recordingFileUrl: rec.recordingFileUrl,
        duration: rec.duration,
        status: rec.status,
        createdAt: rec.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      count: populatedRecords.length,
      data: populatedRecords,
    });
  } catch (error) {
    console.error('Get Live Records Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live records',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete recording document and clean up physical/cloud storage file
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
      return res.status(404).json({ success: false, message: 'Recording not found' });
    }

    if (recording.recordingFileUrl && recording.recordingFileUrl.includes('cloudinary.com')) {
      await deleteCloudinaryByUrl(recording.recordingFileUrl);
    }

    return res.status(200).json({
      success: true,
      message: 'Recording deleted successfully',
    });
  } catch (error) {
    console.error('Delete Recording Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete recording',
      error: error.message,
    });
  }
};
