const mongoose = require('mongoose');
const Course = require('../models/Course');

// Helper to determine query filter (supports MongoDB ObjectId _id or custom courseId)
const getQueryById = (id) => {
  return mongoose.Types.ObjectId.isValid(id)
    ? { _id: id }
    : { courseId: id };
};

// 1. GET ALL COURSES (with optional search and filtering)
// GET /api/courses?category=...&status=...&search=...
exports.getCourses = async (req, res) => {
  try {
    const { category, status, search } = req.query;
    const filter = {};

    if (category) {
      filter.category = { $regex: new RegExp(category, 'i') };
    }

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { courseTitle: { $regex: search, $options: 'i' } },
        { instructor: { $regex: search, $options: 'i' } },
        { shortDescription: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const courses = await Course.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: courses.length,
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

// 2. GET SINGLE COURSE
// GET /api/courses/:id
exports.getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const query = getQueryById(id);

    const course = await Course.findOne(query);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    console.error('Get Single Course Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Error fetching course details',
      error: error.message,
    });
  }
};

// 3. CREATE COURSE
// POST /api/courses
exports.createCourse = async (req, res) => {
  try {
    const {
      courseTitle,
      shortDescription,
      description,
      courseDescription,
      category,
      duration,
      instructor,
      price,
      status,
      thumbnail,
      modules,
    } = req.body;

    const actualShortDescription = shortDescription || description || courseDescription;

    // Validate required fields
    if (
      !courseTitle ||
      !actualShortDescription ||
      !category ||
      !duration ||
      !instructor ||
      price === undefined ||
      price === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Validation failed: Missing required fields (courseTitle, shortDescription, category, duration, instructor, price)',
      });
    }

    const formattedModules = Array.isArray(modules)
      ? modules.map((m) => ({
          moduleName: m.moduleName || m.moduleTitle || '',
          duration: m.duration || '',
          description: m.description || '',
          assignedSubjects: Array.isArray(m.assignedSubjects)
            ? m.assignedSubjects
            : [],
          lessons: Array.isArray(m.lessons) ? m.lessons : [],
        }))
      : [];

    const newCourse = new Course({
      courseTitle,
      shortDescription: actualShortDescription,
      category,
      duration,
      instructor,
      price: Number(price),
      status: status || 'Published',
      thumbnail: thumbnail || '',
      modules: formattedModules,
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

// 4. UPDATE COURSE
// PUT /api/courses/:id
exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const query = getQueryById(id);

    const updateData = {
      ...req.body,
    };

    delete updateData.courseId; // Prevent mutating auto-generated courseId

    if (!updateData.shortDescription) {
      if (updateData.description) {
        updateData.shortDescription = updateData.description;
      } else if (updateData.courseDescription) {
        updateData.shortDescription = updateData.courseDescription;
      }
    }

    if (Array.isArray(updateData.modules)) {
      updateData.modules = updateData.modules.map((m) => ({
        moduleName: m.moduleName || m.moduleTitle || '',
        duration: m.duration || '',
        description: m.description || '',
        assignedSubjects: Array.isArray(m.assignedSubjects)
          ? m.assignedSubjects
          : [],
        lessons: Array.isArray(m.lessons) ? m.lessons : [],
        ...(m._id ? { _id: m._id } : {}),
      }));
    }

    const updatedCourse = await Course.findOneAndUpdate(
      query,
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
      message: error.message || 'Error updating course',
    });
  }
};

// 5. DELETE COURSE
// DELETE /api/courses/:id
exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const query = getQueryById(id);

    const deletedCourse = await Course.findOneAndDelete(query);

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

