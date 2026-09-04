const DemoVideo = require('../models/DemoVideo');
const mongoose = require('mongoose');

// @desc    Create a new demo video
// @route   POST /api/v1/demo-videos
// @access  Private (Admin)
exports.createDemoVideo = async (req, res) => {
  try {
    const { title, description, videoUrl, duration, courseId } = req.body;

    if (!title || !videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Title and videoUrl are required fields',
      });
    }

    let validCourseId = null;
    if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
      validCourseId = courseId;
    }

    const demoVideo = new DemoVideo({
      title,
      description,
      videoUrl,
      duration,
      courseId: validCourseId,
    });

    await demoVideo.save();

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

// @desc    Get all demo videos (optional filter by courseId)
// @route   GET /api/v1/demo-videos
// @access  Public
exports.getDemoVideos = async (req, res) => {
  try {
    const { courseId } = req.query;
    const filter = {};

    if (courseId) {
      if (mongoose.Types.ObjectId.isValid(courseId)) {
        filter.courseId = courseId;
      } else {
        return res.status(400).json({ success: false, message: 'Invalid courseId format' });
      }
    }

    const demoVideos = await DemoVideo.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: demoVideos.length,
      data: demoVideos,
    });
  } catch (error) {
    console.error('Get Demo Videos Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch demo videos',
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

    const updateData = { ...req.body };

    if (updateData.courseId !== undefined) {
      if (updateData.courseId && mongoose.Types.ObjectId.isValid(updateData.courseId)) {
        // Keep as is
      } else {
        updateData.courseId = null;
      }
    }

    const updatedVideo = await DemoVideo.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedVideo) {
      return res.status(404).json({ success: false, message: 'Demo video not found' });
    }

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
