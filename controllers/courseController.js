const mongoose = require('mongoose');
const Course = require('../models/Course');

// Helper to determine query filter (supports MongoDB ObjectId _id or custom courseId)
const getQueryById = (id) => {
  return mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { courseId: id }] }
    : { courseId: id };
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
      thumbnail,
      banner,
      bannerUrl,
      thumbnailUrl,
      image,
      imageUrl,
      courseBanner,
      modules,
    } = req.body;

    const actualShortDescription = shortDescription || description || courseDescription;
    const actualThumbnail =
      thumbnail ||
      banner ||
      bannerUrl ||
      thumbnailUrl ||
      image ||
      imageUrl ||
      courseBanner ||
      '';

    // Validate required fields
    if (
      !courseTitle ||
      !actualShortDescription ||
      !duration ||
      !instructor ||
      price === undefined ||
      price === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Validation failed: Missing required fields (courseTitle, shortDescription, duration, instructor, price)',
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
      thumbnail: actualThumbnail,
      modules: formattedModules,
      category: category || 'Homeopathy',
      modules: Array.isArray(modules) ? modules : [],
    });

    await newCourse.save();

    return res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: newCourse,
      course: newCourse,
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
    const query = getQueryById(id);

    const updateData = {
      ...req.body,
    };

    delete updateData.courseId; // Prevent mutating auto-generated courseId
    delete updateData.category; // Ensure category field in request body is ignored/dropped

    if (!updateData.shortDescription) {
      if (updateData.description) {
        updateData.shortDescription = updateData.description;
      } else if (updateData.courseDescription) {
        updateData.shortDescription = updateData.courseDescription;
      }
    }

    if (!updateData.thumbnail) {
      const bannerVal =
        updateData.banner ||
        updateData.bannerUrl ||
        updateData.thumbnailUrl ||
        updateData.image ||
        updateData.imageUrl ||
        updateData.courseBanner;
      if (bannerVal) {
        updateData.thumbnail = bannerVal;
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
      course: updatedCourse,
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

// 6. ADD MODULE TO COURSE
// POST /api/courses/:id/modules
exports.addModule = async (req, res) => {
  try {
    const { id, courseId } = req.params;
    const targetId = id || courseId;
    const query = getQueryById(targetId);

    const {
      moduleName,
      moduleTitle,
      duration,
      description,
      assignedSubjects,
      lessons,
    } = req.body;

    const actualModuleName = moduleName || moduleTitle;
    const missingFields = [];

    // Validate module-level required fields
    if (!actualModuleName || typeof actualModuleName !== 'string' || !actualModuleName.trim()) {
      missingFields.push('moduleName');
    }

    // Validate nested lessons array if present
    if (lessons !== undefined && lessons !== null) {
      if (!Array.isArray(lessons)) {
        missingFields.push('lessons (must be an array)');
      } else {
        lessons.forEach((lesson, index) => {
          if (!lesson || typeof lesson !== 'object') {
            missingFields.push(`lessons[${index}] (must be an object)`);
          } else {
            const title = lesson.lessonTitle || lesson.title || lesson.lessonName;
            if (!title || typeof title !== 'string' || !title.trim()) {
              missingFields.push(`lessons[${index}].lessonTitle`);
            }
          }
        });
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Validation failed: Missing or invalid required fields (${missingFields.join(', ')})`,
        missingFields,
      });
    }

    const course = await Course.findOne(query);
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

// 7. GET ALL MODULES FOR A COURSE
// GET /api/courses/:courseId/modules
exports.getModules = async (req, res) => {
  try {
    const { id, courseId } = req.params;
    const targetId = courseId || id;
    const query = getQueryById(targetId);

    const course = await Course.findOne(query);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const rawModules = Array.isArray(course.modules) ? course.modules : [];

    // Format modules and nested lessons array
    let modulesList = rawModules.map((m) => {
      const modObj = m && typeof m.toObject === 'function' ? m.toObject({ virtuals: true }) : { ...(m || {}) };
      const rawLessons = Array.isArray(modObj.lessons) ? modObj.lessons : [];

      const formattedLessons = rawLessons.map((l) => {
        const lessObj = l && typeof l.toObject === 'function' ? l.toObject({ virtuals: true }) : { ...(l || {}) };
        const lessonId = lessObj._id
          ? lessObj._id.toString()
          : (lessObj.id ? lessObj.id.toString() : new mongoose.Types.ObjectId().toString());
        const lessonTitle = (lessObj.lessonTitle || lessObj.title || lessObj.lessonName || '').trim();
        const lessonType = lessObj.lessonType || lessObj.type || 'Recorded Video';
        const fileOrLink = (
          lessObj.fileOrLink ||
          lessObj.uploadFileOrLink ||
          lessObj.mediaContent ||
          lessObj.fileUrlOrLink ||
          lessObj.link ||
          ''
        ).trim();

        return {
          _id: lessonId,
          lessonTitle,
          lessonType,
          fileOrLink,
          ...(lessObj.duration ? { duration: lessObj.duration } : {}),
          ...(lessObj.mediaContent ? { mediaContent: lessObj.mediaContent } : {}),
        };
      });

      const moduleId = modObj._id
        ? modObj._id.toString()
        : (modObj.id ? modObj.id.toString() : new mongoose.Types.ObjectId().toString());
      const moduleName = (modObj.moduleName || modObj.moduleTitle || '').trim();

      return {
        _id: moduleId,
        moduleName,
        ...(modObj.duration ? { duration: modObj.duration } : {}),
        ...(modObj.description ? { description: modObj.description } : {}),
        ...(Array.isArray(modObj.assignedSubjects) ? { assignedSubjects: modObj.assignedSubjects } : {}),
        lessons: formattedLessons,
      };
    });

    // Check if standalone Lesson documents exist for this course and merge them if needed
    try {
      const Lesson = require('../models/Lesson.model');
      const searchIds = [course.courseId, course._id.toString()];
      if (targetId && !searchIds.includes(targetId)) {
        searchIds.push(targetId);
      }

      const standaloneLessons = await Lesson.find({ courseId: { $in: searchIds } });
      if (standaloneLessons && standaloneLessons.length > 0) {
        if (modulesList.length === 0) {
          modulesList.push({
            _id: new mongoose.Types.ObjectId().toString(),
            moduleName: 'Module 1 — Course Curriculum',
            lessons: [],
          });
        }

        const existingLessonIds = new Set();
        modulesList.forEach((m) => {
          m.lessons.forEach((l) => existingLessonIds.add(l._id.toString()));
        });

        standaloneLessons.forEach((sl) => {
          const slObj = sl.toObject ? sl.toObject({ virtuals: true }) : sl;
          const slId = slObj._id ? slObj._id.toString() : new mongoose.Types.ObjectId().toString();
          if (!existingLessonIds.has(slId)) {
            modulesList[0].lessons.push({
              _id: slId,
              lessonTitle: (slObj.lessonTitle || slObj.title || '').trim(),
              lessonType: slObj.lessonType || 'Recorded Video',
              fileOrLink: (slObj.fileOrLink || slObj.uploadFileOrLink || slObj.mediaContent || '').trim(),
            });
            existingLessonIds.add(slId);
          }
        });
      }
    } catch (e) {
      // Standalone Lesson query fallback
    }

    return res.status(200).json({
      success: true,
      message: 'Modules fetched successfully',
      count: modulesList.length,
      data: modulesList,
    });
  } catch (error) {
    console.error('Get Modules Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching modules',
    });
  }
};


// 8. GET LESSONS FOR A SPECIFIC MODULE
// GET /api/courses/:courseId/modules/:moduleId/lessons
exports.getLessonsByModule = async (req, res) => {
  try {
    const { id, courseId, moduleId } = req.params;
    const targetId = courseId || id;
    const query = getQueryById(targetId);

    const course = await Course.findOne(query);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const courseModule = course.modules.find(
      (m) => (m._id && m._id.toString() === moduleId) || m.moduleId === moduleId
    );

    if (!courseModule) {
      return res.status(404).json({
        success: false,
        message: 'Module not found',
      });
    }

    const lessonsList = courseModule.lessons || [];

    return res.status(200).json({
      success: true,
      message: 'Lessons fetched successfully',
      count: lessonsList.length,
      data: lessonsList,
      lessons: lessonsList,
    });
  } catch (error) {
    console.error('Get Lessons Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching lessons',
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