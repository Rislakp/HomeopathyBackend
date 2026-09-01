const mongoose = require('mongoose');
const Course = require('../models/Course');

// Helper to determine query filter (supports MongoDB ObjectId _id or custom courseId)
const getQueryById = (id) => {
  return mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { courseId: id }] }
    : { courseId: id };
};

// 1. GET ALL COURSES (with optional search and filtering)
// GET /api/courses?status=...&search=...
exports.getCourses = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { courseTitle: { $regex: search, $options: 'i' } },
        { instructor: { $regex: search, $options: 'i' } },
        { shortDescription: { $regex: search, $options: 'i' } },
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
      duration,
      instructor,
      price,
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

    const newCourse = new Course({
      courseTitle,
      shortDescription: actualShortDescription,
      duration,
      instructor,
      price: Number(price),
      status: status || 'Published',
      thumbnail: actualThumbnail,
      modules: formattedModules,
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

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Parse and format nested lessons
    const formattedLessons = Array.isArray(lessons)
      ? lessons.map((l) => ({
          lessonTitle: (l.lessonTitle || l.title || l.lessonName || '').trim(),
          lessonType: l.lessonType || 'Recorded Video',
          duration: l.duration || '',
          fileOrLink: l.fileOrLink || l.uploadFileOrLink || l.mediaContent || '',
        }))
      : [];

    const newModule = {
      moduleName: actualModuleName.trim(),
      duration: duration || '',
      description: description || '',
      assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [],
      lessons: formattedLessons,
    };

    course.modules.push(newModule);
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
      message: error.message || 'Error adding module to course',
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



