const mongoose = require('mongoose');
const Course = require('../models/Course');

/**
 * Helper function to find a course by either MongoDB ObjectId or custom courseId (e.g., CRS-000001)
 */
const findCourseByIdOrCustomId = async (id) => {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    const course = await Course.findById(id);
    if (course) return course;
  }
  return await Course.findOne({ courseId: id });
};

// ==========================================
// 1. COURSES CRUD CONTROLLERS
// ==========================================

/**
 * @desc    Get all courses for course catalog front view
 * @route   GET /api/courses
 * @access  Public / Admin
 */
exports.getCourses = async (req, res) => {
  try {
    const { search, status, category } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { courseTitle: searchRegex },
        { instructor: searchRegex },
        { courseDescription: searchRegex },
        { category: searchRegex },
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

/**
 * @desc    Fetch a single course with its complete modules and nested lessons tree
 * @route   GET /api/courses/:id
 * @access  Public / Admin
 */
exports.getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await findCourseByIdOrCustomId(id);

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
    console.error('Get Course By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching course details',
      error: error.message,
    });
  }
};

/**
 * @desc    Create a new course
 * @route   POST /api/courses
 * @access  Admin
 */
exports.createCourse = async (req, res) => {
  try {
    const {
      courseBanner,
      courseBannerfileUrlOrLink,
      image,
      courseTitle,
      title,
      instructor,
      price,
      courseDescription,
      description,
      status,
      category,
      modules,
    } = req.body;

    const newCourse = new Course({
      courseBanner: courseBanner || courseBannerfileUrlOrLink || image || '',
      courseTitle: courseTitle || title,
      instructor,
      price: typeof price === 'number' ? price : Number(price),
      courseDescription: courseDescription || description,
      status: status || 'Published',
      category: category || 'Homeopathy',
      modules: Array.isArray(modules) ? modules : [],
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
      message: 'Internal server error while creating course',
      error: error.message,
    });
  }
};

/**
 * @desc    Update course metadata and details
 * @route   PUT /api/courses/:id
 * @access  Admin
 */
exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await findCourseByIdOrCustomId(id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const {
      courseBanner,
      courseBannerfileUrlOrLink,
      image,
      courseTitle,
      title,
      instructor,
      price,
      courseDescription,
      description,
      status,
      category,
      modules,
    } = req.body;

    if (courseBanner !== undefined || courseBannerfileUrlOrLink !== undefined || image !== undefined) {
      course.courseBanner = courseBanner || courseBannerfileUrlOrLink || image || '';
    }
    if (courseTitle !== undefined || title !== undefined) {
      course.courseTitle = courseTitle || title;
    }
    if (instructor !== undefined) {
      course.instructor = instructor;
    }
    if (price !== undefined) {
      course.price = typeof price === 'number' ? price : Number(price);
    }
    if (courseDescription !== undefined || description !== undefined) {
      course.courseDescription = courseDescription || description;
    }
    if (status !== undefined) {
      course.status = status;
    }
    if (category !== undefined) {
      course.category = category;
    }
    if (Array.isArray(modules)) {
      course.modules = modules;
    }

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: course,
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
      message: 'Error updating course',
      error: error.message,
    });
  }
};

/**
 * @desc    Remove a course record and its associated curriculum
 * @route   DELETE /api/courses/:id
 * @access  Admin
 */
exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await findCourseByIdOrCustomId(id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    await Course.findByIdAndDelete(course._id);

    return res.status(200).json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    console.error('Delete Course Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting course',
      error: error.message,
    });
  }
};

// ==========================================
// 2. MODULES CRUD (SUBDOCUMENT OPERATIONS)
// ==========================================

/**
 * @desc    Add a new module to a course
 * @route   POST /api/courses/:courseId/modules
 * @access  Admin
 */
exports.addModule = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { moduleName } = req.body;

    if (!moduleName || !moduleName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a module name',
      });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    course.modules.push({
      moduleName: moduleName.trim(),
      lessons: [],
    });

    await course.save();

    const createdModule = course.modules[course.modules.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Module added successfully',
      data: createdModule,
      course,
    });
  } catch (error) {
    console.error('Add Module Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add module',
      error: error.message,
    });
  }
};

/**
 * @desc    Update a module inside a course
 * @route   PUT /api/courses/:courseId/modules/:moduleId
 * @access  Admin
 */
exports.updateModule = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;
    const { moduleName } = req.body;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({
        success: false,
        message: 'Module not found in this course',
      });
    }

    if (moduleName) {
      moduleItem.moduleName = moduleName.trim();
    }

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Module updated successfully',
      data: moduleItem,
      course,
    });
  } catch (error) {
    console.error('Update Module Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update module',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete a module and its nested lessons
 * @route   DELETE /api/courses/:courseId/modules/:moduleId
 * @access  Admin
 */
exports.deleteModule = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({
        success: false,
        message: 'Module not found',
      });
    }

    course.modules.pull(moduleId);
    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Module deleted successfully',
      course,
    });
  } catch (error) {
    console.error('Delete Module Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete module',
      error: error.message,
    });
  }
};

// ==========================================
// 3. NESTED LESSONS CRUD (SUBDOC OPERATIONS)
// ==========================================

/**
 * @desc    Add a new lesson to a specific module
 * @route   POST /api/courses/:courseId/modules/:moduleId/lessons
 * @access  Admin
 */
exports.addLesson = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;
    const {
      lessonTitle,
      lessonType,
      fileOrLink,
      fileUrlOrLink,
      uploadFileOrLink,
    } = req.body;

    if (!lessonTitle || !lessonTitle.trim()) {
      return res.status(400).json({
        success: false,
        message: 'lessonTitle is required',
      });
    }

    const allowedTypes = ['Live Class', 'Recorded Video', 'PDF Notes', 'Assignment'];
    if (!lessonType || !allowedTypes.includes(lessonType)) {
      return res.status(400).json({
        success: false,
        message: `lessonType must be one of: ${allowedTypes.join(', ')}`,
      });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({
        success: false,
        message: 'Module not found in this course',
      });
    }

    const newLesson = {
      lessonTitle: lessonTitle.trim(),
      lessonType,
      fileOrLink: fileOrLink || fileUrlOrLink || uploadFileOrLink || '',
    };

    moduleItem.lessons.push(newLesson);
    await course.save();

    const createdLesson = moduleItem.lessons[moduleItem.lessons.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Lesson added successfully',
      data: createdLesson,
      course,
    });
  } catch (error) {
    console.error('Add Lesson Error:', error);

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
      message: 'Failed to add lesson to module',
      error: error.message,
    });
  }
};

/**
 * @desc    Update an existing lesson inside a module
 * @route   PUT /api/courses/:courseId/modules/:moduleId/lessons/:lessonId
 * @access  Admin
 */
exports.updateLesson = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;
    const {
      lessonTitle,
      lessonType,
      fileOrLink,
      fileUrlOrLink,
      uploadFileOrLink,
    } = req.body;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({
        success: false,
        message: 'Module not found in this course',
      });
    }

    const lessonItem = moduleItem.lessons.id(lessonId);
    if (!lessonItem) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found in this module',
      });
    }

    if (lessonTitle !== undefined) {
      lessonItem.lessonTitle = lessonTitle.trim();
    }

    if (lessonType !== undefined) {
      const allowedTypes = ['Live Class', 'Recorded Video', 'PDF Notes', 'Assignment'];
      if (!allowedTypes.includes(lessonType)) {
        return res.status(400).json({
          success: false,
          message: `lessonType must be one of: ${allowedTypes.join(', ')}`,
        });
      }
      lessonItem.lessonType = lessonType;
    }

    if (fileOrLink !== undefined || fileUrlOrLink !== undefined || uploadFileOrLink !== undefined) {
      lessonItem.fileOrLink = fileOrLink !== undefined
        ? fileOrLink
        : (fileUrlOrLink !== undefined ? fileUrlOrLink : uploadFileOrLink);
    }

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: lessonItem,
      course,
    });
  } catch (error) {
    console.error('Update Lesson Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update lesson',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete a specific lesson from a module
 * @route   DELETE /api/courses/:courseId/modules/:moduleId/lessons/:lessonId
 * @access  Admin
 */
exports.deleteLesson = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({
        success: false,
        message: 'Module not found in this course',
      });
    }

    const lessonItem = moduleItem.lessons.id(lessonId);
    if (!lessonItem) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found in this module',
      });
    }

    moduleItem.lessons.pull(lessonId);
    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson deleted successfully',
      course,
    });
  } catch (error) {
    console.error('Delete Lesson Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete lesson',
      error: error.message,
    });
  }
};