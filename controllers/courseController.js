const Course = require('../models/Course');
const mongoose = require('mongoose');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper to handle querying by custom courseId or _id
const getQueryById = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { _id: id };
  }
  return { courseId: id };
};

const findCourseByIdOrCustomId = async (id) => {
  return await Course.findOne({
    $or: [
      { courseId: id },
      { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
    ],
  });
};

// ==========================================
// 1. COURSES CRUD
// ==========================================

exports.getCourses = async (req, res) => {
  try {
    const courses = await Course.find();
    return res.status(200).json({
      success: true,
      count: courses.length,
      data: courses,
      courses,
    });
  } catch (error) {
    console.error('Get Courses Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: error.message,
    });
  }
};

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
      course,
    });
  } catch (error) {
    console.error('Get Course By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching course',
      error: error.message,
    });
  }
};

exports.createCourse = async (req, res) => {
  try {
    const {
      courseBannerfileUrlOrLink,
      courseTitle,
      title,
      instructor,
      price,
      courseDescription,
      description,
      shortDescription,
      duration,
      status,
      thumbnail,
      banner,
      bannerUrl,
      thumbnailUrl,
      image,
      imageUrl,
      courseBanner,
      category,
      modules,
    } = req.body;

    const actualShortDescription = shortDescription || description || courseDescription;
    const actualThumbnail =
      thumbnail || banner || bannerUrl || thumbnailUrl || image || imageUrl || courseBanner || '';

    if (!courseTitle && !title) {
      return res.status(400).json({ success: false, message: 'courseTitle is required' });
    }

    const formattedModules = Array.isArray(modules) ? modules.map((m) => ({
      moduleName: m.moduleName || m.moduleTitle || '',
      lessons: Array.isArray(m.lessons) ? m.lessons : [],
    })) : [];

    const newCourse = new Course({
      courseTitle: courseTitle || title,
      instructor: instructor || 'Unknown',
      price: typeof price === 'number' ? price : Number(price) || 0,
      shortDescription: actualShortDescription || '',
      duration: duration || '',
      status: status || 'Published',
      thumbnail: actualThumbnail,
      category: category || 'Homeopathy',
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
    return res.status(500).json({
      success: false,
      message: 'Internal server error while creating course',
      error: error.message,
    });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const query = getQueryById(id);
    const updateData = { ...req.body };

    delete updateData.courseId; // Prevent mutating auto-generated courseId

    if (!updateData.shortDescription) {
      if (updateData.description) updateData.shortDescription = updateData.description;
      else if (updateData.courseDescription) updateData.shortDescription = updateData.courseDescription;
    }

    const bannerVal = updateData.thumbnail || updateData.banner || updateData.bannerUrl || updateData.thumbnailUrl || updateData.image || updateData.imageUrl || updateData.courseBanner;
    if (bannerVal) updateData.thumbnail = bannerVal;

    const updatedCourse = await Course.findOneAndUpdate(query, updateData, { new: true, runValidators: true });

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse,
      course: updatedCourse,
    });
  } catch (error) {
    console.error('Update Course Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error updating course',
    });
  }
};

exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const query = getQueryById(id);
    const deletedCourse = await Course.findOneAndDelete(query);

    if (!deletedCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({ success: true, message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Delete Course Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Error deleting course' });
  }
};

// ==========================================
// 2. MODULES CRUD
// ==========================================

exports.getModules = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await findCourseByIdOrCustomId(courseId);

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({ success: true, data: course.modules });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch modules', error: error.message });
  }
};

exports.addModule = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { moduleName, moduleTitle } = req.body;
    const actualModuleName = moduleName || moduleTitle;

    if (!actualModuleName || !actualModuleName.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide a module name' });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    course.modules.push({ moduleName: actualModuleName.trim(), lessons: [] });
    await course.save();

    return res.status(201).json({
      success: true,
      message: 'Module added successfully',
      data: course.modules[course.modules.length - 1],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to add module', error: error.message });
  }
};

exports.updateModule = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;
    
    if (!isValidObjectId(moduleId)) {
      return res.status(400).json({ success: false, message: 'Invalid module ID format' });
    }

    const { moduleName, moduleTitle } = req.body;
    const actualModuleName = moduleName || moduleTitle;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    if (actualModuleName) moduleItem.moduleName = actualModuleName;
    await course.save();

    return res.status(200).json({ success: true, message: 'Module updated successfully', data: moduleItem });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update module', error: error.message });
  }
};

exports.deleteModule = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;

    if (!isValidObjectId(moduleId)) {
      return res.status(400).json({ success: false, message: 'Invalid module ID format' });
    }

    const query = {
      $or: [
        { courseId: courseId },
        { _id: mongoose.Types.ObjectId.isValid(courseId) ? courseId : null },
      ],
    };

    const updatedCourse = await Course.findOneAndUpdate(
      query,
      { $pull: { modules: { _id: moduleId } } },
      { new: true }
    );

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course or Module not found' });
    }

    return res.status(200).json({ success: true, message: 'Module deleted successfully', data: updatedCourse });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete module', error: error.message });
  }
};

// ==========================================
// 3. LESSONS CRUD
// ==========================================

exports.getLessonsByModule = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;

    if (!isValidObjectId(moduleId)) {
      return res.status(400).json({ success: false, message: 'Invalid module ID format' });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    res.status(200).json({ success: true, message: 'Lessons fetched successfully', data: moduleItem.lessons });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch lessons', error: error.message });
  }
};

exports.addLesson = async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;

    if (!isValidObjectId(moduleId)) {
      return res.status(400).json({ success: false, message: 'Invalid module ID format' });
    }

    const {
      lessonTitle,
      lessonType,
      instructor,
      description,
      durationOrPages,
      visibility,
      status,
      scheduleDate,
      scheduleTime,
      mediaUrlOrPath,
      uploadFileOrLink,
      fileOrLink,
      videoParts,
    } = req.body;

    if (!lessonTitle || !lessonTitle.trim()) {
      return res.status(400).json({ success: false, message: 'lessonTitle is required' });
    }

    const allowedTypes = ['Live Class', 'Recorded Video', 'PDF Notes', 'Assignment', 'video', 'pdf', 'link', 'document', 'audio'];
    if (!lessonType || !allowedTypes.includes(lessonType)) {
      return res.status(400).json({ success: false, message: `lessonType must be one of: ${allowedTypes.join(', ')}` });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    const mediaUrl = mediaUrlOrPath || uploadFileOrLink || fileOrLink || '';

    const newLesson = {
      lessonTitle: lessonTitle.trim(),
      lessonType,
      instructor: instructor ? instructor.trim() : '',
      description: description ? description.trim() : '',
      durationOrPages: durationOrPages || '',
      visibility: visibility || 'Public',
      status: status || 'Published',
      scheduleDate: scheduleDate || '',
      scheduleTime: scheduleTime || '',
      mediaUrlOrPath: mediaUrl,
      uploadFileOrLink: mediaUrl,
      videoParts: Array.isArray(videoParts) ? videoParts : [],
    };

    moduleItem.lessons.push(newLesson);
    await course.save();

    res.status(201).json({
      success: true,
      message: 'Lesson added successfully',
      data: moduleItem.lessons[moduleItem.lessons.length - 1],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add lesson', error: error.message });
  }
};

exports.updateLesson = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;

    if (!isValidObjectId(moduleId) || !isValidObjectId(lessonId)) {
      return res.status(400).json({ success: false, message: 'Invalid module or lesson ID format' });
    }

    const {
      lessonTitle,
      lessonType,
      instructor,
      description,
      durationOrPages,
      visibility,
      status,
      scheduleDate,
      scheduleTime,
      mediaUrlOrPath,
      uploadFileOrLink,
      fileOrLink,
      videoParts,
    } = req.body;

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const targetModule = course.modules.id(moduleId);
    if (!targetModule) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const targetLesson = targetModule.lessons.id(lessonId);
    if (!targetLesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Cleanly map fields with undefined checks
    if (lessonTitle !== undefined) {
      targetLesson.lessonTitle = lessonTitle;
    }
    if (lessonType !== undefined) {
      const allowedTypes = ['Live Class', 'Recorded Video', 'PDF Notes', 'Assignment', 'video', 'pdf', 'link', 'document', 'audio'];
      if (!allowedTypes.includes(lessonType)) {
        return res.status(400).json({ success: false, message: `lessonType must be one of: ${allowedTypes.join(', ')}` });
      }
      targetLesson.lessonType = lessonType;
    }
    if (instructor !== undefined) {
      targetLesson.instructor = instructor;
    }
    if (description !== undefined) {
      targetLesson.description = description;
    }
    if (durationOrPages !== undefined) {
      targetLesson.durationOrPages = durationOrPages;
    }
    if (visibility !== undefined) {
      targetLesson.visibility = visibility;
    }
    if (status !== undefined) {
      targetLesson.status = status;
    }
    if (scheduleDate !== undefined) {
      targetLesson.scheduleDate = scheduleDate;
    }
    if (scheduleTime !== undefined) {
      targetLesson.scheduleTime = scheduleTime;
    }
    if (mediaUrlOrPath !== undefined) {
      targetLesson.mediaUrlOrPath = mediaUrlOrPath;
      if (uploadFileOrLink === undefined) {
        targetLesson.uploadFileOrLink = mediaUrlOrPath;
      }
    }
    if (uploadFileOrLink !== undefined) {
      targetLesson.uploadFileOrLink = uploadFileOrLink;
      if (mediaUrlOrPath === undefined) {
        targetLesson.mediaUrlOrPath = uploadFileOrLink;
      }
    }
    if (fileOrLink !== undefined) {
      if (mediaUrlOrPath === undefined) targetLesson.mediaUrlOrPath = fileOrLink;
      if (uploadFileOrLink === undefined) targetLesson.uploadFileOrLink = fileOrLink;
    }
    if (videoParts !== undefined) {
      targetLesson.videoParts = Array.isArray(videoParts) ? videoParts : [];
    }

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: targetLesson,
    });
  } catch (error) {
    console.error("Error updating lesson:", error);
    return res.status(500).json({ success: false, message: 'Failed to update lesson', error: error.message });
  }
};

exports.deleteLesson = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;
    
    if (!isValidObjectId(moduleId) || !isValidObjectId(lessonId)) {
      return res.status(400).json({ success: false, message: 'Invalid module or lesson ID format' });
    }

    const query = {
      $or: [
        { courseId: courseId },
        { _id: mongoose.Types.ObjectId.isValid(courseId) ? courseId : null },
      ],
    };

    const updatedCourse = await Course.findOneAndUpdate(
      query,
      { $pull: { "modules.$[mod].lessons": { _id: lessonId } } },
      { arrayFilters: [{ "mod._id": moduleId }], new: true }
    );

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course, Module, or Lesson not found' });
    }

    res.status(200).json({ success: true, message: 'Lesson deleted successfully', data: updatedCourse });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete lesson', error: error.message });
  }
};
