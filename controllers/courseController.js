const Course = require('../models/Course');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Serialize a lesson subdocument into a plain object that always
 * includes every multi-file array so the frontend can safely iterate
 * without defensive null checks on each field.
 */
const serializeLesson = (lesson) => ({
  _id: lesson._id,
  lessonTitle: lesson.lessonTitle || '',
  lessonType: lesson.lessonType || 'Video',
  duration: lesson.duration || '',
  description: lesson.description || '',
  videoUrl: lesson.videoUrl || '',
  videoParts: Array.isArray(lesson.videoParts) ? lesson.videoParts : [],
  pdfNotes: Array.isArray(lesson.pdfNotes) ? lesson.pdfNotes : [],
  attachments: Array.isArray(lesson.attachments) ? lesson.attachments : [],
  assignments: Array.isArray(lesson.assignments) ? lesson.assignments : [],
  meetingUrl: lesson.meetingUrl || '',
  status: lesson.status || 'Published',
  createdAt: lesson.createdAt,
  updatedAt: lesson.updatedAt,
});

/**
 * Serialize a module subdocument, mapping each lesson through serializeLesson.
 */
const serializeModule = (mod) => ({
  ...mod.toObject ? mod.toObject() : mod,
  lessons: Array.isArray(mod.lessons)
    ? mod.lessons.map(serializeLesson)
    : [],
});

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
    const serialized = courses.map((course) => ({
      ...course.toObject(),
      modules: course.modules.map(serializeModule),
    }));
    return res.status(200).json({
      success: true,
      count: serialized.length,
      data: serialized,
      courses: serialized,
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

    const serialized = {
      ...course.toObject(),
      modules: course.modules.map(serializeModule),
    };

    return res.status(200).json({
      success: true,
      data: serialized,
      course: serialized,
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

    const modules = course.modules.map(serializeModule);
    return res.status(200).json({ success: true, data: modules });
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

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    // Use pull to remove the module and save the course, ensuring we return the fully updated course object
    course.modules.pull(moduleId);
    await course.save();

    return res.status(200).json({ 
      success: true, 
      message: 'Module deleted successfully', 
      data: course 
    });
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

    const lessons = moduleItem.lessons.map(serializeLesson);
    res.status(200).json({ success: true, message: 'Lessons fetched successfully', data: lessons });
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
      duration,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
      assignments,
      status
    } = req.body;

    if (!lessonTitle || !lessonTitle.trim()) {
      return res.status(400).json({ success: false, message: 'lessonTitle is required' });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    // Build initial arrays from body fields
    let finalVideoUrl = videoUrl ? videoUrl.trim() : '';
    let finalVideoParts = Array.isArray(videoParts) ? [...videoParts] : [];
    let finalPdfNotes = Array.isArray(pdfNotes) ? [...pdfNotes] : (typeof pdfNotes === 'string' && pdfNotes ? [pdfNotes] : []);
    let finalAttachments = Array.isArray(attachments) ? [...attachments] : (typeof attachments === 'string' && attachments ? [attachments] : []);
    let finalAssignments = Array.isArray(assignments) ? [...assignments] : (typeof assignments === 'string' && assignments ? [assignments] : []);

    // Map uploaded files to the correct field based on fieldname / mimetype
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    filesList.forEach((f) => {
      if (f && f.filename) {
        const filePath = `/uploads/${f.filename}`;
        if (f.fieldname === 'videoUrl' || f.fieldname === 'video') {
          finalVideoUrl = filePath;
        } else if (f.fieldname === 'videoParts') {
          finalVideoParts.push({ partTitle: f.originalname || '', partUrl: filePath });
        } else if (f.fieldname === 'pdfNotes' || f.fieldname === 'pdf') {
          finalPdfNotes.push(filePath);
        } else if (f.fieldname === 'attachments' || f.fieldname === 'attachment') {
          finalAttachments.push(filePath);
        } else if (f.fieldname === 'assignments' || f.fieldname === 'assignment') {
          finalAssignments.push(filePath);
        } else if (f.mimetype && f.mimetype.startsWith('video/')) {
          finalVideoUrl = filePath;
        } else if (f.mimetype === 'application/pdf') {
          finalPdfNotes.push(filePath);
        } else {
          finalAttachments.push(filePath);
        }
      }
    });

    const newLesson = {
      lessonTitle: lessonTitle.trim(),
      lessonType: lessonType || 'Video',
      duration: duration ? duration.trim() : '',
      description: description ? description.trim() : '',
      meetingUrl: meetingUrl ? meetingUrl.trim() : '',
      videoUrl: finalVideoUrl,
      videoParts: finalVideoParts,
      pdfNotes: finalPdfNotes,
      attachments: finalAttachments,
      assignments: finalAssignments,
      status: status || 'Published',
    };

    moduleItem.lessons.push(newLesson);
    await course.save();

    const saved = moduleItem.lessons[moduleItem.lessons.length - 1];
    res.status(201).json({
      success: true,
      message: 'Lesson added successfully',
      data: serializeLesson(saved),
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
      duration,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
      assignments,
      status
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

    // Cleanly map scalar fields with undefined guards
    if (lessonTitle !== undefined) targetLesson.lessonTitle = lessonTitle;
    if (lessonType !== undefined) targetLesson.lessonType = lessonType;
    if (duration !== undefined) targetLesson.duration = duration;
    if (description !== undefined) targetLesson.description = description;
    if (meetingUrl !== undefined) targetLesson.meetingUrl = meetingUrl;
    if (status !== undefined) targetLesson.status = status;
    if (videoUrl !== undefined) targetLesson.videoUrl = videoUrl;

    // Array fields — replace entirely when provided via body
    if (videoParts !== undefined) {
      targetLesson.videoParts = Array.isArray(videoParts) ? videoParts : [];
    }
    if (pdfNotes !== undefined) {
      targetLesson.pdfNotes = Array.isArray(pdfNotes)
        ? pdfNotes
        : (typeof pdfNotes === 'string' && pdfNotes ? [pdfNotes] : []);
    }
    if (attachments !== undefined) {
      targetLesson.attachments = Array.isArray(attachments)
        ? attachments
        : (typeof attachments === 'string' && attachments ? [attachments] : []);
    }
    if (assignments !== undefined) {
      targetLesson.assignments = Array.isArray(assignments)
        ? assignments
        : (typeof assignments === 'string' && assignments ? [assignments] : []);
    }

    // -----------------------------------------------------------------
    // MULTER FILE ATTACHMENT MAPPING
    // Uploaded files are appended to the matching array field.
    // -----------------------------------------------------------------
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    filesList.forEach((f) => {
      if (f && f.filename) {
        const filePath = `/uploads/${f.filename}`;
        if (f.fieldname === 'videoUrl' || f.fieldname === 'video') {
          targetLesson.videoUrl = filePath;
        } else if (f.fieldname === 'videoParts') {
          targetLesson.videoParts.push({ partTitle: f.originalname || '', partUrl: filePath });
        } else if (f.fieldname === 'pdfNotes' || f.fieldname === 'pdf') {
          targetLesson.pdfNotes.push(filePath);
        } else if (f.fieldname === 'attachments' || f.fieldname === 'attachment') {
          targetLesson.attachments.push(filePath);
        } else if (f.fieldname === 'assignments' || f.fieldname === 'assignment') {
          targetLesson.assignments.push(filePath);
        } else if (f.mimetype && f.mimetype.startsWith('video/')) {
          targetLesson.videoUrl = filePath;
        } else if (f.mimetype === 'application/pdf') {
          targetLesson.pdfNotes.push(filePath);
        } else {
          targetLesson.attachments.push(filePath);
        }
      }
    });

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: serializeLesson(targetLesson),
    });
  } catch (error) {
    console.error('Error updating lesson:', error);
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
      "modules._id": moduleId
    };

    // 1. Fetch the course first to extract file paths before deletion
    const course = await Course.findOne(query);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course or module not found' });
    }

    const targetModule = course.modules.id(moduleId);
    const targetLesson = targetModule ? targetModule.lessons.id(lessonId) : null;
    
    if (!targetLesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Collect local paths associated with this lesson
    const filesToDelete = [];
    if (targetLesson.videoUrl && targetLesson.videoUrl.startsWith('/uploads/')) {
      filesToDelete.push(targetLesson.videoUrl);
    }
    if (Array.isArray(targetLesson.pdfNotes)) {
      targetLesson.pdfNotes.forEach(f => { if (f && f.startsWith('/uploads/')) filesToDelete.push(f); });
    }
    if (Array.isArray(targetLesson.assignments)) {
      targetLesson.assignments.forEach(f => { if (f && f.startsWith('/uploads/')) filesToDelete.push(f); });
    }

    // 2. Perform the atomic pull from the nested array as requested
    const updatedCourse = await Course.findOneAndUpdate(
      query,
      { $pull: { "modules.$.lessons": { _id: lessonId } } },
      { new: true }
    );

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course, module, or lesson not found' });
    }

    // 3. Clean up the physical files gracefully (doesn't block response and ignores missing files)
    filesToDelete.forEach((filePath) => {
      // Remove leading slash to correctly join path from project root
      const absolutePath = path.join(__dirname, '..', filePath.replace(/^\//, ''));
      fs.unlink(absolutePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error(`Failed to delete local file ${absolutePath}:`, err);
        }
      });
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Lesson deleted successfully', 
      data: updatedCourse 
    });
  } catch (error) {
    console.error("Error deleting lesson:", error);
    return res.status(500).json({ success: false, message: 'Failed to delete lesson', error: error.message });
  }
};
