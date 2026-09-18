const DemoVideo = require('../models/DemoVideo');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const { deleteCloudinaryByUrl } = require('../config/cloudinary');

// Helper to extract file url from uploaded file object
const extractUrl = (f) => {
  if (!f) return '';
  if (f.secure_url && f.secure_url.startsWith('http')) return f.secure_url;
  if (f.url && f.url.startsWith('http')) return f.url;
  if (f.path && f.path.startsWith('http')) return f.path;
  return f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : '');
};

// Helper to find and validate course in DB
async function findCourseByIdOrCustomId(courseIdInput) {
  if (!courseIdInput) return null;
  const cleanId = String(courseIdInput).trim();
  const query = [{ courseId: cleanId }];
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    query.push({ _id: new mongoose.Types.ObjectId(cleanId) });
  }
  return await Course.findOne({ $or: query });
}

// @desc    Create a new demo video
// @route   POST /api/v1/demo-videos
// @access  Private (Admin)
exports.createDemoVideo = async (req, res) => {
  try {
    const { title, description, duration, courseId } = req.body;

    // 1. Accept either an uploaded file or a plain URL string from the request body.
    const videoUrl = req.file
      ? extractUrl(req.file)
      : (req.body.videoUrl || '').trim();

    const thumbnailUrl = (req.body.thumbnailUrl || req.body.thumbnail || '').trim();

    // 2. Validate Title
    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required',
      });
    }

    // 3. Validate Video URL
    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'A video file upload or a videoUrl string is required',
      });
    }

    // 4. Validate Course ID (Mandatory)
    if (!courseId || typeof courseId !== 'string' || !courseId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'courseId is required',
      });
    }

    const cleanCourseId = courseId.trim();

    // 5. Validate that the Course exists in MongoDB
    const course = await findCourseByIdOrCustomId(cleanCourseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: `Course with courseId "${cleanCourseId}" not found`,
      });
    }

    const canonicalCourseId = course.courseId || cleanCourseId;

    // 6. Create Demo Video Record
    const demoVideo = new DemoVideo({
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      videoUrl,
      thumbnailUrl,
      thumbnail: thumbnailUrl,
      duration: duration ? String(duration).trim() : '',
      courseId: canonicalCourseId,
      courseRef: course._id,
    });

    await demoVideo.save();

    // 7. Debug Logging
    console.log('========== DEMO VIDEO CREATE ==========');
    console.log(`courseId: ${demoVideo.courseId}`);
    console.log(`title: ${demoVideo.title}`);
    console.log(`videoUrl: ${demoVideo.videoUrl}`);
    console.log('=======================================');

    return res.status(201).json({
      success: true,
      message: 'Demo video created successfully',
      data: demoVideo,
    });
  } catch (error) {
    console.error('Create Demo Video Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while creating demo video',
      error: error.message,
    });
  }
};

// @desc    Get demo videos (supports ?courseId=CRS-000039 query param)
// @route   GET /api/v1/demo-videos, GET /api/student/demo-videos
// @access  Public / Student / Admin
exports.getDemoVideos = async (req, res) => {
  try {
    const isStaff = ['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase());
    const { courseId } = req.query;
    let filter = {};
    let resolvedCourseId = null;

    if (courseId && typeof courseId === 'string' && courseId.trim()) {
      const cleanCourseId = courseId.trim();
      const course = await findCourseByIdOrCustomId(cleanCourseId);
      resolvedCourseId = course?.courseId || cleanCourseId;

      filter = {
        $or: [
          { courseId: resolvedCourseId },
          { courseId: cleanCourseId },
          ...(course?._id ? [{ courseRef: course._id }] : [])
        ]
      };
    } else if (!isStaff && req.user) {
      const studentCourseRef = req.user.courseRef;
      const studentCourseId = req.user.courseId;

      const courseOrFilter = [];
      if (studentCourseId) {
        courseOrFilter.push({ courseId: studentCourseId });
      }
      if (studentCourseRef && mongoose.Types.ObjectId.isValid(studentCourseRef)) {
        courseOrFilter.push({ courseRef: new mongoose.Types.ObjectId(studentCourseRef) });
      }

      if (courseOrFilter.length > 0) {
        filter = { $or: courseOrFilter };
      }
    }

    const demoVideos = await DemoVideo.find(filter).sort({ createdAt: -1 });

    // Debug Logging
    console.log('========== DEMO VIDEO QUERY ==========');
    console.log(`courseId: ${resolvedCourseId || courseId || (filter.$or ? 'STUDENT_FILTER' : 'ALL')}`);
    console.log(`Mongo query: ${JSON.stringify(filter)}`);
    console.log(`results: ${demoVideos.length}`);
    console.log('=======================================');

    const responsePayload = {
      success: true,
      count: demoVideos.length,
      data: demoVideos,
    };

    if (resolvedCourseId) {
      responsePayload.courseId = resolvedCourseId;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Get Demo Videos Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch demo videos',
      error: error.message,
    });
  }
};

// @desc    Get demo videos for a specific course
// @route   GET /api/v1/courses/:courseId/demo-videos, GET /api/courses/:courseId/demo-videos, GET /api/v1/demo-videos/course/:courseId
// @access  Public / Student / Admin
exports.getCourseDemoVideos = async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId || !courseId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'courseId is required',
      });
    }

    const cleanCourseId = courseId.trim();

    // 1. Validate course exists in database
    const course = await findCourseByIdOrCustomId(cleanCourseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: `Course with courseId "${cleanCourseId}" not found`,
      });
    }

    const canonicalCourseId = course.courseId || cleanCourseId;

    // 2. Query demo videos strictly belonging to this course
    const filter = {
      $or: [
        { courseId: canonicalCourseId },
        { courseId: cleanCourseId },
        ...(course._id ? [{ courseRef: course._id }] : [])
      ]
    };

    const demoVideos = await DemoVideo.find(filter).sort({ createdAt: -1 });

    // 3. Debug Logging
    console.log('========== DEMO VIDEO QUERY ==========');
    console.log(`courseId: ${canonicalCourseId}`);
    console.log(`Mongo query: ${JSON.stringify(filter)}`);
    console.log(`results: ${demoVideos.length}`);
    console.log('=======================================');

    return res.status(200).json({
      success: true,
      courseId: canonicalCourseId,
      count: demoVideos.length,
      data: demoVideos,
    });
  } catch (error) {
    console.error('Get Course Demo Videos Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch course demo videos',
      error: error.message,
    });
  }
};

// @desc    Get a single demo video by ID
// @route   GET /api/v1/demo-videos/:id
// @access  Public
exports.getDemoVideoById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid demo video ID format' });
    }

    const demoVideo = await DemoVideo.findById(id);

    if (!demoVideo) {
      return res.status(404).json({
        success: false,
        message: 'Demo video not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: demoVideo,
    });
  } catch (error) {
    console.error('Get Demo Video By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching demo video',
      error: error.message,
    });
  }
};

// @desc    Update a demo video
// @route   PUT /api/v1/demo-videos/:id
// @access  Private (Admin)
exports.updateDemoVideo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid demo video ID format' });
    }

    const existingVideo = await DemoVideo.findById(id);
    if (!existingVideo) {
      return res.status(404).json({ success: false, message: 'Demo video not found' });
    }

    const updateData = {};

    if (req.body.title !== undefined) updateData.title = String(req.body.title).trim();
    if (req.body.description !== undefined) updateData.description = String(req.body.description).trim();
    if (req.body.duration !== undefined) updateData.duration = String(req.body.duration).trim();

    // If a new video file was uploaded, overwrite videoUrl with the uploaded public URL.
    if (req.file) {
      updateData.videoUrl = extractUrl(req.file);
    } else if (req.body.videoUrl) {
      updateData.videoUrl = String(req.body.videoUrl).trim();
    }

    if (req.body.thumbnailUrl !== undefined || req.body.thumbnail !== undefined) {
      const thumb = (req.body.thumbnailUrl || req.body.thumbnail || '').trim();
      updateData.thumbnailUrl = thumb;
      updateData.thumbnail = thumb;
    }

    // Handle courseId update safely
    if (req.body.courseId !== undefined && req.body.courseId !== null) {
      const cleanCourseId = String(req.body.courseId).trim();
      if (cleanCourseId) {
        const course = await findCourseByIdOrCustomId(cleanCourseId);
        if (!course) {
          return res.status(404).json({
            success: false,
            message: `Course with courseId "${cleanCourseId}" not found`,
          });
        }
        updateData.courseId = course.courseId || cleanCourseId;
        updateData.courseRef = course._id;
      }
    }

    const updatedVideo = await DemoVideo.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Demo video updated successfully',
      data: updatedVideo,
    });
  } catch (error) {
    console.error('Update Demo Video Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating demo video',
      error: error.message,
    });
  }
};

// @desc    Delete a demo video
// @route   DELETE /api/v1/demo-videos/:id
// @access  Private (Admin)
exports.deleteDemoVideo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid demo video ID format' });
    }

    const deletedVideo = await DemoVideo.findByIdAndDelete(id);

    if (!deletedVideo) {
      return res.status(404).json({ success: false, message: 'Demo video not found' });
    }

    if (deletedVideo.videoUrl && deletedVideo.videoUrl.includes('cloudinary.com')) {
      await deleteCloudinaryByUrl(deletedVideo.videoUrl);
    }

    return res.status(200).json({
      success: true,
      message: 'Demo video deleted successfully',
      data: deletedVideo,
    });
  } catch (error) {
    console.error('Delete Demo Video Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting demo video',
      error: error.message,
    });
  }
};
