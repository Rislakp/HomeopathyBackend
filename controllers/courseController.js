const Course = require('../models/Course');

// GET ALL COURSES
exports.getCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: courses,
    });
  } catch (error) {
    console.error('Get Courses Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Error fetching courses',
      error: error.message,
    });
  }
};

// CREATE COURSE
exports.createCourse = async (req, res) => {
  try {
    const {
      courseTitle,
      instructor,
      category,
      price,
    } = req.body;

    const newCourse = new Course({
      courseTitle,
      instructor,
      category,
      price,
    });

    await newCourse.save();

    return res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: newCourse,
    });
  } catch (error) {
    console.error('Create Course Error:', error);

    if (error.name === 'ValidationError') {
      const errors = {};

      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// UPDATE COURSE
exports.updateCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const updateData = {
      ...req.body,
    };

    delete updateData.courseId;

    const updatedCourse = await Course.findOneAndUpdate(
      { courseId },
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedCourse) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse,
    });
  } catch (error) {
    console.error('Update Course Error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Error updating course',
    });
  }
};

// DELETE COURSE
exports.deleteCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    const deletedCourse = await Course.findOneAndDelete({
      courseId,
    });

    if (!deletedCourse) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    console.error('Delete Course Error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Error deleting course',
    });
  }
};