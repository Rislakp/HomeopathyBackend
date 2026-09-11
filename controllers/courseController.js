const Course = require('../models/Course');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { deleteCloudinaryByUrl } = require('../config/cloudinary');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id); 

const normalizeFileUrl = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const normalizedPath = trimmed.replace(/\\/g, '/');
  const uploadsIndex = normalizedPath.toLowerCase().lastIndexOf('/uploads/');
  if (uploadsIndex >= 0) {
    return `/uploads/${normalizedPath.slice(uploadsIndex + '/uploads/'.length)}`;
  }
  if (normalizedPath.startsWith('/uploads/')) return normalizedPath;
  return `/uploads/${normalizedPath.replace(/^\/+/, '')}`;
};

/**
 * Normalise a single raw resource item (string or object) into the
 * { title, url } shape expected by resourceSchema.
 */
const toResourceObj = (item) => {
  if (!item) return null;
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    const url = normalizeFileUrl(trimmed);
    let title = trimmed;
    try {
      if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        const name = path.basename(parsed.pathname);
        title = name ? decodeURIComponent(name) : trimmed;
      }
    } catch (_) {
      title = trimmed;
    }
    return { title, url };
  }
  if (typeof item === 'object' && !Array.isArray(item)) {
    const url = normalizeFileUrl(item.url || item.secure_url || item.path || item.partUrl || item.fileUrl || item.link || item.filename || '');
    let title = item.title || item.name || item.partTitle || item.originalname || item.filename || '';
    if (!title && url) {
      try {
        if (/^https?:\/\//i.test(url)) {
          const parsed = new URL(url);
          const name = path.basename(parsed.pathname);
          title = name ? decodeURIComponent(name) : 'Resource';
        } else if (typeof url === 'string') {
          title = path.basename(url) || 'Resource';
        }
      } catch (_) {
        title = 'Resource';
      }
    }
    return {
      title: (title || '').trim(),
      url: (url || '').trim(),
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
    return items.map(toResourceObj).filter((item) => item && (item.url || item.title));
  }

  // Single string — try JSON-parse first, then treat as bare URL/filename or comma-separated
  if (typeof items === 'string') {
    const trimmed = items.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map(toResourceObj).filter((item) => item && (item.url || item.title));
    } catch (e) {
      if (trimmed.includes(',') && trimmed.startsWith('http')) {
        return trimmed.split(',').map((s) => toResourceObj(s.trim())).filter(Boolean);
      }
      const obj = toResourceObj(trimmed);
      return obj ? [obj] : [];
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

const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, '');
  }
  if (req && req.get && typeof req.get === 'function' && req.get('host')) {
    const protocol = req.headers && req.headers['x-forwarded-proto']
      ? req.headers['x-forwarded-proto']
      : (req.protocol || 'https');
    return `${protocol}://${req.get('host')}`;
  }
  return 'https://homeopathybackend-1.onrender.com';
};

const toAbsoluteUrl = (urlStr, req) => {
  if (typeof urlStr !== 'string') return '';
  const trimmed = urlStr.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const baseUrl = getBaseUrl(req);
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${baseUrl}${cleanPath}`;
};

/**
 * Serialize a lesson subdocument into a plain object with absolute file URLs.
 */
const serializeLesson = (lesson, req) => {
  const sanitizeResource = (items) => {
    const list = sanitizeFiles(items);
    return list.map((item) => ({
      ...item,
      url: toAbsoluteUrl(item.url, req),
    }));
  };

  return {
    _id: lesson._id,
    lessonTitle: lesson.lessonTitle || '',
    lessonType: lesson.lessonType || 'Recorded Video',
    durationOrPages: lesson.durationOrPages || '',
    description: lesson.description || '',
    videoUrl: toAbsoluteUrl(lesson.videoUrl || '', req),
    videoParts:  sanitizeResource(lesson.videoParts),
    pdfNotes:    sanitizeResource(lesson.pdfNotes),
    attachments: sanitizeResource(lesson.attachments),
    meetingUrl: lesson.meetingUrl || '',
    status: lesson.status || 'Published',
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
};

/**
 * Serialize a module subdocument, mapping each lesson through serializeLesson.
 */
const serializeModule = (mod, req) => ({
  ...mod.toObject ? mod.toObject({ virtuals: true }) : mod,
  lessons: Array.isArray(mod.lessons)
    ? mod.lessons.map((l) => serializeLesson(l, req))
    : [],
});

/**
 * Serialize a course document with standardized absolute banner URLs and module trees.
 */
const serializeCourse = (courseDoc, req) => {
  if (!courseDoc) return null;
  const obj = courseDoc.toObject ? courseDoc.toObject({ virtuals: true }) : { ...courseDoc };

  const rawBanner = obj.courseBanner || obj.thumbnail || obj.bannerUrl || obj.banner || obj.thumbnailUrl || obj.image || obj.imageUrl || '';
  const absoluteBanner = toAbsoluteUrl(rawBanner, req);

  obj.thumbnail = absoluteBanner;
  obj.bannerUrl = absoluteBanner;
  obj.courseBanner = absoluteBanner;
  obj.banner = absoluteBanner;
  obj.thumbnailUrl = absoluteBanner;
  obj.image = absoluteBanner;
  obj.imageUrl = absoluteBanner;

  if (Array.isArray(obj.modules)) {
    obj.modules = obj.modules.map((mod) => serializeModule(mod, req));
  }

  return obj;
};

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
    const serialized = courses.map((course) => serializeCourse(course, req));
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

    const serialized = serializeCourse(course, req);

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
      bannerUrl: actualThumbnail,
      courseBanner: actualThumbnail,
      category: category || 'Homeopathy',
      modules: formattedModules,
    });

    await newCourse.save();
    const serialized = serializeCourse(newCourse, req);

    return res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: serialized,
      course: serialized,
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
    if (bannerVal) {
      updateData.thumbnail = bannerVal;
      updateData.bannerUrl = bannerVal;
      updateData.courseBanner = bannerVal;
    }

    const updatedCourse = await Course.findOneAndUpdate(query, updateData, { new: true, runValidators: true });

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const serialized = serializeCourse(updatedCourse, req);

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: serialized,
      course: serialized,
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

    const modules = course.modules.map((m) => serializeModule(m, req));
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

    const serializedCourse = serializeCourse(course, req);

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

    const lessons = moduleItem.lessons.map((l) => serializeLesson(l, req));
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
      title,
      lessonType,
      type,
      durationOrPages,
      duration,
      pages,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
      uploadFileOrLink,
      fileOrLink,
      lessonFile,
      status,
    } = req.body;

    const actualLessonTitle = (lessonTitle || title || '').trim();
    if (!actualLessonTitle) {
      return res.status(400).json({ success: false, message: 'lessonTitle is required' });
    }

    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) return res.status(404).json({ success: false, message: 'Module not found' });

    const actualLessonType = (lessonType || type || 'Recorded Video').trim();
    let actualMeetingUrl = (meetingUrl || '').trim();
    let finalVideoUrl = (videoUrl || '').trim();
    let finalVideoParts = parseFileItems(videoParts);
    let finalPdfNotes = parseFileItems(pdfNotes);
    let finalAttachments = parseFileItems(attachments);

    // Map legacy single link/file fields if provided
    const singleLink = (uploadFileOrLink || fileOrLink || lessonFile || '').trim();
    if (singleLink) {
      const lowerType = actualLessonType.toLowerCase();
      if (lowerType.includes('video') || lowerType === 'recorded video') {
        if (!finalVideoUrl) finalVideoUrl = singleLink;
        if (!finalVideoParts.some((p) => p.url === singleLink)) {
          finalVideoParts.push({ title: actualLessonTitle || 'Video Part 1', url: singleLink });
        }
      } else if (lowerType.includes('pdf')) {
        if (!finalPdfNotes.some((p) => p.url === singleLink)) {
          finalPdfNotes.push({ title: actualLessonTitle || 'PDF Notes', url: singleLink });
        }
      } else if (lowerType.includes('live') || lowerType === 'link') {
        if (!actualMeetingUrl) actualMeetingUrl = singleLink;
      } else {
        if (!finalAttachments.some((p) => p.url === singleLink)) {
          finalAttachments.push({ title: actualLessonTitle || 'Attachment', url: singleLink });
        }
      }
    }

    // Map uploaded multipart files (streamed to Cloudinary or disk)
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    filesList.forEach((f) => {
      if (f && (f.secure_url || f.url || f.path || f.filename)) {
        const fileUrl = normalizeFileUrl(f.secure_url || f.url || f.path || f.filename || '');
        const fileTitle = f.originalname || f.filename || 'Resource';
        const fileObj = { title: fileTitle, url: fileUrl };
        const field = (f.fieldname || '').toLowerCase();
        const mime = (f.mimetype || '').toLowerCase();

        if (field === 'videourl' || field === 'video' || field === 'videofile') {
          finalVideoUrl = fileUrl;
          if (!finalVideoParts.some((p) => p.url === fileUrl)) {
            finalVideoParts.push(fileObj);
          }
        } else if (field === 'videoparts' || field === 'videopart' || field.startsWith('videoparts') || field === 'videos') {
          finalVideoParts.push(fileObj);
          if (!finalVideoUrl) finalVideoUrl = fileUrl;
        } else if (field === 'pdfnotes' || field === 'pdf' || field === 'pdffile' || field.startsWith('pdfnotes') || field === 'pdfs') {
          finalPdfNotes.push(fileObj);
        } else if (field === 'attachments' || field === 'attachment' || field === 'assignments' || field === 'assignment' || field.startsWith('attachments')) {
          finalAttachments.push(fileObj);
        } else if (field === 'file' || field === 'lessonfile' || field === 'uploadfileorlink') {
          if (mime.startsWith('video/')) {
            finalVideoUrl = fileUrl;
            if (!finalVideoParts.some((p) => p.url === fileUrl)) finalVideoParts.push(fileObj);
          } else if (mime === 'application/pdf') {
            finalPdfNotes.push(fileObj);
          } else {
            finalAttachments.push(fileObj);
          }
        } else if (mime.startsWith('video/')) {
          finalVideoUrl = fileUrl;
          if (!finalVideoParts.some((p) => p.url === fileUrl)) finalVideoParts.push(fileObj);
        } else if (mime === 'application/pdf') {
          finalPdfNotes.push(fileObj);
        } else {
          finalAttachments.push(fileObj);
        }
      }
    });

    // Auto-sync videoUrl with videoParts if single video was provided
    if (finalVideoUrl && finalVideoParts.length === 0) {
      finalVideoParts.push({ title: actualLessonTitle || 'Video Part 1', url: finalVideoUrl });
    } else if (!finalVideoUrl && finalVideoParts.length > 0) {
      finalVideoUrl = finalVideoParts[0].url;
    }

    const newLesson = {
      lessonTitle: actualLessonTitle,
      lessonType: actualLessonType,
      durationOrPages: (durationOrPages || duration || pages || '').trim(),
      description: (description || '').trim(),
      meetingUrl: actualMeetingUrl,
      videoUrl: finalVideoUrl,
      videoParts: finalVideoParts,
      pdfNotes: finalPdfNotes,
      attachments: finalAttachments,
      status: (status || 'Published').trim(),
    };

    moduleItem.lessons.push(newLesson);
    await course.save();

    const saved = moduleItem.lessons[moduleItem.lessons.length - 1];
    return res.status(201).json({
      success: true,
      message: 'Lesson added successfully',
      data: serializeLesson(saved, req),
      lesson: serializeLesson(saved, req),
    });
  } catch (error) {
    console.error('Failed to add lesson:', error);
    return res.status(500).json({ success: false, message: 'Failed to add lesson', error: error.message });
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
      title,
      lessonType,
      type,
      durationOrPages,
      duration,
      pages,
      description,
      meetingUrl,
      videoUrl,
      videoParts,
      pdfNotes,
      attachments,
      uploadFileOrLink,
      fileOrLink,
      lessonFile,
      status,
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

    // Update scalar fields when defined
    if (lessonTitle !== undefined || title !== undefined) {
      targetLesson.lessonTitle = (lessonTitle || title || '').trim();
    }
    if (lessonType !== undefined || type !== undefined) {
      targetLesson.lessonType = (lessonType || type || '').trim();
    }
    if (durationOrPages !== undefined || duration !== undefined || pages !== undefined) {
      targetLesson.durationOrPages = (durationOrPages || duration || pages || '').trim();
    }
    if (description !== undefined) targetLesson.description = description.trim();
    if (meetingUrl !== undefined) targetLesson.meetingUrl = meetingUrl.trim();
    if (status !== undefined) targetLesson.status = status.trim();
    if (videoUrl !== undefined) targetLesson.videoUrl = videoUrl.trim();

    // Array fields — replace when provided in body
    if (videoParts !== undefined) {
      targetLesson.videoParts = parseFileItems(videoParts);
    }
    if (pdfNotes !== undefined) {
      targetLesson.pdfNotes = parseFileItems(pdfNotes);
    }
    if (attachments !== undefined) {
      targetLesson.attachments = parseFileItems(attachments);
    }

    // Map single link if provided
    const singleLink = (uploadFileOrLink || fileOrLink || lessonFile || '').trim();
    if (singleLink) {
      const lowerType = (targetLesson.lessonType || '').toLowerCase();
      if (lowerType.includes('video') || lowerType === 'recorded video') {
        targetLesson.videoUrl = singleLink;
        if (!targetLesson.videoParts.some((p) => p.url === singleLink)) {
          targetLesson.videoParts.push({ title: targetLesson.lessonTitle || 'Video Part', url: singleLink });
        }
      } else if (lowerType.includes('pdf')) {
        if (!targetLesson.pdfNotes.some((p) => p.url === singleLink)) {
          targetLesson.pdfNotes.push({ title: targetLesson.lessonTitle || 'PDF Notes', url: singleLink });
        }
      } else if (lowerType.includes('live') || lowerType === 'link') {
        targetLesson.meetingUrl = singleLink;
      } else {
        if (!targetLesson.attachments.some((p) => p.url === singleLink)) {
          targetLesson.attachments.push({ title: targetLesson.lessonTitle || 'Attachment', url: singleLink });
        }
      }
    }

    // Map newly uploaded multipart files
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    filesList.forEach((f) => {
      if (f && (f.secure_url || f.url || f.path || f.filename)) {
        const fileUrl = normalizeFileUrl(f.secure_url || f.url || f.path || f.filename || '');
        const fileTitle = f.originalname || f.filename || 'Resource';
        const fileObj = { title: fileTitle, url: fileUrl };
        const field = (f.fieldname || '').toLowerCase();
        const mime = (f.mimetype || '').toLowerCase();

        if (field === 'videourl' || field === 'video' || field === 'videofile') {
          targetLesson.videoUrl = fileUrl;
          if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) {
            targetLesson.videoParts.push(fileObj);
          }
        } else if (field === 'videoparts' || field === 'videopart' || field.startsWith('videoparts') || field === 'videos') {
          targetLesson.videoParts.push(fileObj);
          if (!targetLesson.videoUrl) targetLesson.videoUrl = fileUrl;
        } else if (field === 'pdfnotes' || field === 'pdf' || field === 'pdffile' || field.startsWith('pdfnotes') || field === 'pdfs') {
          targetLesson.pdfNotes.push(fileObj);
        } else if (field === 'attachments' || field === 'attachment' || field === 'assignments' || field === 'assignment' || field.startsWith('attachments')) {
          targetLesson.attachments.push(fileObj);
        } else if (field === 'file' || field === 'lessonfile' || field === 'uploadfileorlink') {
          if (mime.startsWith('video/')) {
            targetLesson.videoUrl = fileUrl;
            if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) targetLesson.videoParts.push(fileObj);
          } else if (mime === 'application/pdf') {
            targetLesson.pdfNotes.push(fileObj);
          } else {
            targetLesson.attachments.push(fileObj);
          }
        } else if (mime.startsWith('video/')) {
          targetLesson.videoUrl = fileUrl;
          if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) targetLesson.videoParts.push(fileObj);
        } else if (mime === 'application/pdf') {
          targetLesson.pdfNotes.push(fileObj);
        } else {
          targetLesson.attachments.push(fileObj);
        }
      }
    });

    if (targetLesson.videoUrl && targetLesson.videoParts.length === 0) {
      targetLesson.videoParts.push({ title: targetLesson.lessonTitle || 'Video Part 1', url: targetLesson.videoUrl });
    }

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: serializeLesson(targetLesson, req),
      lesson: serializeLesson(targetLesson, req),
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

    // Collect local paths or Cloudinary URLs associated with this lesson across all fields.
    const filesToDelete = [];
    if (targetLesson.videoUrl) {
      filesToDelete.push(targetLesson.videoUrl);
    }
    if (Array.isArray(targetLesson.videoParts)) {
      targetLesson.videoParts.forEach((f) => {
        const fileUrl = typeof f === 'object' ? f.url : f;
        if (fileUrl) filesToDelete.push(fileUrl);
      });
    }
    if (Array.isArray(targetLesson.pdfNotes)) {
      targetLesson.pdfNotes.forEach((f) => {
        const fileUrl = typeof f === 'object' ? f.url : f;
        if (fileUrl) filesToDelete.push(fileUrl);
      });
    }
    if (Array.isArray(targetLesson.attachments)) {
      targetLesson.attachments.forEach((f) => {
        const fileUrl = typeof f === 'object' ? f.url : f;
        if (fileUrl) filesToDelete.push(fileUrl);
      });
    }

    // 2. Perform the atomic pull from the nested array
    const updatedCourse = await Course.findOneAndUpdate(
      query,
      { $pull: { "modules.$.lessons": { _id: lessonId } } },
      { new: true }
    );

    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course, module, or lesson not found' });
    }

    // 3. Clean up the physical / Cloudinary files gracefully
    const uniqueUrls = [...new Set(filesToDelete.filter(Boolean))];
    await Promise.all(
      uniqueUrls.map(async (filePath) => {
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

    const serializedCourse = serializeCourse(updatedCourse, req);

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

