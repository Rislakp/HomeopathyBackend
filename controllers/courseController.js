const Course = require('../models/Course');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { deleteCloudinaryByUrl } = require('../config/cloudinary');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Normalise a single raw resource item (string or object) into the
 * { title, url } shape expected by resourceSchema.
 */
const toResourceObj = (item) => {
  if (!item) return null;
  if (typeof item === 'string' && item.trim()) {
    return { title: item.trim(), url: item.trim() };
  }
  if (typeof item === 'object' && !Array.isArray(item)) {
    return {
      title: item.title || item.name || item.partTitle || '',
      url:   item.url   || item.partUrl || item.fileUrl || '',
    };
  }
  return null;
};

/**
 * Parse an incoming field value into an array of resourceSchema objects.
 * Handles: undefined/null → [], array of strings, array of objects,
 * a single string (JSON-encoded array or bare filename), a single object.
 */
const parseFileItems = (items) => {
  if (!items) return [];

  // Already an array — normalise every element
  if (Array.isArray(items)) {
    return items.map(toResourceObj).filter(Boolean);
  }

  // Single string — try JSON-parse first, then treat as bare filename
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map(toResourceObj).filter(Boolean);
    } catch (e) {
      return [{ title: items.trim(), url: items.trim() }];
    }
  }

  // Single plain object
  if (typeof items === 'object') {
    const obj = toResourceObj(items);
    return obj ? [obj] : [];
  }

  return [];
};

/**
 * Sanitize a multi-file array (videoParts, pdfNotes, attachments).
 * Converts every element — including legacy string-indexed objects like
 * {"0":"v","1":"i"} produced by older Mongoose versions — into clean
 * { title: string, url: string } objects. Invalid items are dropped.
 */
const sanitizeFiles = (files) => {
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => {
      // Already a Mongoose subdoc or plain object with expected keys
      if (f && typeof f === 'object' && !Array.isArray(f)) {
        // Detect legacy string-indexed objects: all own keys are digit strings
        const keys = Object.keys(f).filter(k => k !== '_id');
        const isStringIndexed = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
        if (isStringIndexed) {
          // Re-assemble the original string value from its characters
          const str = keys
            .sort((a, b) => Number(a) - Number(b))
            .map(k => f[k])
            .join('');
          return str ? { title: str, url: str } : null;
        }
        // Normal object — pass through toResourceObj for key normalisation
        return toResourceObj(f);
      }
      return toResourceObj(f);
    })
    .filter(Boolean);
};

/**
 * Serialize a lesson subdocument into a plain object that always
 * includes every multi-file array so the frontend can safely iterate
 * without defensive null checks on each field.
 * sanitizeFiles() is applied to every array field so that legacy or
 * malformed subdocuments never reach the client.
 */
const serializeLesson = (lesson) => ({
  _id: lesson._id,
  lessonTitle: lesson.lessonTitle || '',
  lessonType: lesson.lessonType || 'Recorded Video',
  durationOrPages: lesson.durationOrPages || '',
  description: lesson.description || '',
  videoUrl: lesson.videoUrl || '',
  videoParts:  sanitizeFiles(lesson.videoParts),
  pdfNotes:    sanitizeFiles(lesson.pdfNotes),
  attachments: sanitizeFiles(lesson.attachments),
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

    const actualShortDescription = shortDescription || description || courseDescription || '';
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

    if (updateData.title !== undefined) {
      updateData.courseTitle = updateData.title;
      delete updateData.title;
    }
    if (updateData.description !== undefined) {
      updateData.shortDescription = updateData.description;
      delete updateData.description;
    }

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

    const serializedCourse = {
      ...course.toObject(),
      modules: course.modules.map(serializeModule)
    };

    return res.status(200).json({ 
      success: true, 
      message: 'Module deleted successfully', 
      data: serializedCourse
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
      durationOrPages,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
      status
    } = req.body;

    if (!lessonTitle || !lessonTitle.trim()) {
      return res.status(400).json({ success: false, message: 'lessonTitle is required' });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    // Build initial arrays from body fields.
    // normalizeVideoParts handles bare strings, {partUrl}, {url}, {videoUrl} objects.
    let finalVideoUrl = videoUrl ? videoUrl.trim() : '';
    let finalVideoParts = parseFileItems(videoParts);
    let finalPdfNotes = parseFileItems(pdfNotes);
    let finalAttachments = parseFileItems(attachments);

    // Map uploaded files to the correct field based on fieldname / mimetype
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    filesList.forEach((f) => {
      if (f && (f.filename || f.originalname || f.url || f.path)) {
        const fileUrl = f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : '');
        const fileObj = { url: fileUrl, title: f.originalname || f.filename };

        if (f.fieldname === 'videoUrl' || f.fieldname === 'video') {
          finalVideoUrl = fileUrl;
        } else if (f.fieldname === 'videoParts') {
          finalVideoParts.push(fileObj);
        } else if (f.fieldname === 'pdfNotes' || f.fieldname === 'pdf') {
          finalPdfNotes.push(fileObj);
        } else if (f.fieldname === 'attachments' || f.fieldname === 'attachment' || f.fieldname === 'assignments' || f.fieldname === 'assignment') {
          finalAttachments.push(fileObj);
        } else if (f.mimetype && f.mimetype.startsWith('video/')) {
          finalVideoUrl = fileUrl;
        } else if (f.mimetype === 'application/pdf') {
          finalPdfNotes.push(fileObj);
        } else {
          finalAttachments.push(fileObj);
        }
      }
    });

    const newLesson = {
      lessonTitle: lessonTitle.trim(),
      lessonType: lessonType || 'Recorded Video',
      durationOrPages: durationOrPages ? durationOrPages.trim() : '',
      description: description ? description.trim() : '',
      meetingUrl: meetingUrl ? meetingUrl.trim() : '',
      videoUrl: finalVideoUrl,
      videoParts: finalVideoParts,
      pdfNotes: finalPdfNotes,
      attachments: finalAttachments,
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
      durationOrPages,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
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
    if (durationOrPages !== undefined) targetLesson.durationOrPages = durationOrPages;
    if (description !== undefined) targetLesson.description = description;
    if (meetingUrl !== undefined) targetLesson.meetingUrl = meetingUrl;
    if (status !== undefined) targetLesson.status = status;
    if (videoUrl !== undefined) targetLesson.videoUrl = videoUrl;

    // Array fields — replace entirely when provided via body.
    if (videoParts !== undefined) {
      targetLesson.videoParts = parseFileItems(videoParts);
    }
    if (pdfNotes !== undefined) {
      targetLesson.pdfNotes = parseFileItems(pdfNotes);
    }
    if (attachments !== undefined) {
      targetLesson.attachments = parseFileItems(attachments);
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
      if (f && (f.filename || f.originalname || f.url || f.path)) {
        const fileUrl = f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : '');
        const fileObj = { url: fileUrl, title: f.originalname || f.filename };

        if (f.fieldname === 'videoUrl' || f.fieldname === 'video') {
          targetLesson.videoUrl = fileUrl;
        } else if (f.fieldname === 'videoParts') {
          targetLesson.videoParts.push(fileObj);
        } else if (f.fieldname === 'pdfNotes' || f.fieldname === 'pdf') {
          targetLesson.pdfNotes.push(fileObj);
        } else if (f.fieldname === 'attachments' || f.fieldname === 'attachment' || f.fieldname === 'assignments' || f.fieldname === 'assignment') {
          targetLesson.attachments.push(fileObj);
        } else if (f.mimetype && f.mimetype.startsWith('video/')) {
          targetLesson.videoUrl = fileUrl;
        } else if (f.mimetype === 'application/pdf') {
          targetLesson.pdfNotes.push(fileObj);
        } else {
          targetLesson.attachments.push(fileObj);
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

    // Collect local paths or Cloudinary URLs associated with this lesson.
    const filesToDelete = [];
    if (targetLesson.videoUrl && targetLesson.videoUrl.startsWith('/uploads/')) {
      filesToDelete.push(targetLesson.videoUrl);
    }
    if (targetLesson.videoUrl && targetLesson.videoUrl.includes('cloudinary.com')) {
      filesToDelete.push(targetLesson.videoUrl);
    }
    if (Array.isArray(targetLesson.pdfNotes)) {
      targetLesson.pdfNotes.forEach(f => {
        const fileUrl = typeof f === 'object' ? f.url : f;
        if (fileUrl && fileUrl.startsWith('/uploads/')) filesToDelete.push(fileUrl);
        if (fileUrl && fileUrl.includes('cloudinary.com')) filesToDelete.push(fileUrl);
      });
    }
    if (Array.isArray(targetLesson.attachments)) {
      targetLesson.attachments.forEach(f => {
        const fileUrl = typeof f === 'object' ? f.url : f;
        if (fileUrl && fileUrl.startsWith('/uploads/')) filesToDelete.push(fileUrl);
        if (fileUrl && fileUrl.includes('cloudinary.com')) filesToDelete.push(fileUrl);
      });
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

    // 3. Clean up the physical files gracefully (doesn't block response and ignores missing files).
    await Promise.all(
      filesToDelete.map(async (filePath) => {
        if (filePath && filePath.includes('cloudinary.com')) {
          await deleteCloudinaryByUrl(filePath);
          return;
        }

        if (filePath && filePath.startsWith('/uploads/')) {
          const absolutePath = path.join(__dirname, '..', filePath.replace(/^\//, ''));
          fs.unlink(absolutePath, (err) => {
            if (err && err.code !== 'ENOENT') {
              console.error(`Failed to delete local file ${absolutePath}:`, err);
            }
          });
        }
      })
    );

    const serializedCourse = {
      ...updatedCourse.toObject(),
      modules: updatedCourse.modules.map(serializeModule)
    };

    return res.status(200).json({ 
      success: true, 
      message: 'Lesson deleted successfully', 
      data: serializedCourse 
    });
  } catch (error) {
    console.error("Error deleting lesson:", error);
    return res.status(500).json({ success: false, message: 'Failed to delete lesson', error: error.message });
  }
};
