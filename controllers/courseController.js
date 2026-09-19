const mimeTypes = require('mime-types');
const Course = require('../models/Course');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { deleteCloudinaryByUrl, getPublicIdFromUrl, parseCloudinaryUrl, uploadBufferToCloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const { extractCleanNameAndExt } = require('../middleware/upload');

const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
const ALLOWED_DOC_FORMATS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar'];

// Version identifier for debugging
console.log('✨ LESSON API VERSION: MIME-DEBUG-2026-09-15');

// 2. Helper to safely process file attachments without naming any local variable "mime"
const processAttachments = (filesArray) => {
  if (!filesArray || !Array.isArray(filesArray)) return [];
  return filesArray.map((f) => {
    const fileUrl = f.secure_url || f.url || '';
    const fileTitle = f.originalname || f.filename || 'Resource';
    const fileMimeType = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
    const ext = path.extname(f.originalname || f.filename || fileUrl || '').toLowerCase().replace('.', '');
    const isVideo = fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(ext) || fileUrl.includes('/video/upload/');
    const isPdf = fileMimeType === 'application/pdf' || ext === 'pdf' || /\.pdf(?:[?#]|$)/i.test(fileUrl);
    const explicitResourceType = f.resource_type || (isVideo ? 'video' : (isPdf ? 'raw' : 'auto'));

    return {
      title: fileTitle,
      url: fileUrl,
      public_id: f.public_id || (fileUrl.includes('cloudinary.com') ? (getPublicIdFromUrl(fileUrl) || '') : '') || '',
      secure_url: f.secure_url || fileUrl,
      resource_type: explicitResourceType,
      mimetype: isPdf ? 'application/pdf' : fileMimeType,
      size: Number(f.bytes || f.size || 0),
    };
  });
};

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
 * { title, url, secure_url, public_id, resource_type, mimetype, size } shape expected by resourceSchema.
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

    let resourceType = '';
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/video/upload/')) resourceType = 'video';
    else if (lowerUrl.includes('/raw/upload/') || /\.pdf([?#]|$)/i.test(lowerUrl)) resourceType = 'raw';
    else if (lowerUrl.includes('/image/upload/')) resourceType = 'image';

    const publicId = url.includes('cloudinary.com') ? (getPublicIdFromUrl(url) || '') : '';

    return {
      title: title.trim(),
      url: url.trim(),
      secure_url: url.trim(),
      public_id: publicId,
      resource_type: resourceType,
      mimetype: resourceType === 'raw' && /\.pdf([?#]|$)/i.test(lowerUrl) ? 'application/pdf' : '',
      size: 0,
    };
  }
  if (typeof item === 'object' && !Array.isArray(item)) {
    const cloudUrl = (item.secure_url && item.secure_url.startsWith('http'))
      ? item.secure_url
      : (item.url && item.url.startsWith('http'))
        ? item.url
        : (item.path && item.path.startsWith('http'))
          ? item.path
          : null;
    const rawUrl = cloudUrl || item.url || item.secure_url || item.path || item.partUrl || item.fileUrl || item.link || item.filename || '';
    const url = normalizeFileUrl(rawUrl);
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

    const secureUrl = (item.secure_url && item.secure_url.startsWith('http'))
      ? item.secure_url
      : (cloudUrl || url || '');

    let resType = item.resource_type || '';
    const lowerUrl = (secureUrl || url || '').toLowerCase();
    if (!resType && lowerUrl) {
      if (lowerUrl.includes('/video/upload/')) resType = 'video';
      else if (lowerUrl.includes('/raw/upload/') || /\.pdf([?#]|$)/i.test(lowerUrl)) resType = 'raw';
      else if (lowerUrl.includes('/image/upload/')) resType = 'image';
    }

    let publicId = (item.public_id || '').trim();
    if (!publicId && lowerUrl.includes('cloudinary.com')) {
      publicId = getPublicIdFromUrl(secureUrl || url) || '';
    }

    return {
      title: (title || '').trim(),
      url: (url || '').trim(),
      secure_url: (secureUrl || url || '').trim(),
      public_id: publicId,
      resource_type: (resType || '').trim(),
      mimetype: (item.mimetype || (resType === 'raw' && /\.pdf([?#]|$)/i.test(lowerUrl) ? 'application/pdf' : '')).trim(),
      size: typeof item.size === 'number' ? item.size : (Number(item.size) || 0),
    };
  }
  return null;
};

/**
 * Parse an incoming field value into an array of resourceSchema objects.
 * Handles: undefined/null → [], array of strings, array of objects,
 * a single string (JSON-encoded array or bare filename), a single object.
 */

/**
 * De-duplicate an array of resource objects based on public_id, secure_url, url, or title
 */
const deduplicateResourceArray = (arr) => {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.filter((item) => {
    if (!item) return false;
    const urlKey = (item.secure_url || item.url || '').trim();
    const idKey = (item.public_id || item.publicId || '').trim();
    const titleKey = (item.title || item.name || '').trim();
    const key = idKey ? ('id:' + idKey) : (urlKey ? ('url:' + urlKey) : (titleKey ? ('title:' + titleKey) : ''));
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Helper to compute identity key for a resource.
 * Identity is based on public_id or secure_url/url (never filename alone).
 */
const getResourceKey = (item) => {
  if (!item) return '';
  const pubId = (item.public_id || item.publicId || '').trim();
  if (pubId) return `pub:${pubId}`;
  const url = (item.secure_url || item.url || '').trim();
  if (url) return `url:${url.toLowerCase()}`;
  return '';
};

/**
 * Keeps resource categories independent. Explicit request categories can remove
 * a resource from another category, but file metadata never chooses pdfNotes.
 */
const sanitizeAndIsolateResourceArrays = ({
  videoParts = [],
  pdfNotes = [],
  assignments = [],
  attachments = [],
  explicitCategoryMap = new Map(),
}) => {
  let cleanVideoParts = deduplicateResourceArray(videoParts);
  let cleanPdfNotes = deduplicateResourceArray(pdfNotes);
  let cleanAssignments = deduplicateResourceArray(assignments);
  let cleanAttachments = deduplicateResourceArray(attachments);

  const allCategories = [
    { name: 'assignments', items: cleanAssignments },
    { name: 'attachments', items: cleanAttachments },
    { name: 'videoParts', items: cleanVideoParts },
    { name: 'pdfNotes', items: cleanPdfNotes },
  ];

  // Only an explicit request source may move a resource between categories.
  // GET serialization must never infer a category from a URL, extension, or MIME type.
  if (explicitCategoryMap && explicitCategoryMap.size > 0) {
    for (const category of allCategories) {
      const filteredItems = category.items.filter((item) => {
        const key = getResourceKey(item);
        const explicitCategory = key ? explicitCategoryMap.get(key) : undefined;
        return !explicitCategory || explicitCategory === category.name;
      });

      if (category.name === 'videoParts') cleanVideoParts = filteredItems;
      if (category.name === 'pdfNotes') cleanPdfNotes = filteredItems;
      if (category.name === 'assignments') cleanAssignments = filteredItems;
      if (category.name === 'attachments') cleanAttachments = filteredItems;
    }
  }

  return {
    videoParts: cleanVideoParts,
    pdfNotes: cleanPdfNotes,
    assignments: cleanAssignments,
    attachments: cleanAttachments,
  };
};

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
    return list.map((item) => {
      const canonicalUrl = item.secure_url || item.url || '';
      const absUrl = toAbsoluteUrl(canonicalUrl, req);
      return {
        ...item,
        url: absUrl,
        secure_url: absUrl,
      };
    });
  };

  const rawVideoParts = sanitizeResource(lesson.videoParts);
  const rawPdfNotes = sanitizeResource(lesson.pdfNotes);
  const rawAssignments = sanitizeResource(lesson.assignments);
  const rawAttachments = sanitizeResource(lesson.attachments);

  const isolated = sanitizeAndIsolateResourceArrays({
    videoParts: rawVideoParts,
    pdfNotes: rawPdfNotes,
    assignments: rawAssignments,
    attachments: rawAttachments,
  });

  return {
    _id: lesson._id,
    lessonTitle: lesson.lessonTitle || '',
    lessonType: lesson.lessonType || 'Recorded Video',
    durationOrPages: lesson.durationOrPages || '',
    description: lesson.description || '',
    videoUrl: toAbsoluteUrl(lesson.videoUrl || '', req),
    videoParts: isolated.videoParts,
    pdfNotes: isolated.pdfNotes,
    assignments: isolated.assignments,
    attachments: isolated.attachments,
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

    // Extract banner URL from uploaded file if present (multipart image upload from Flutter admin)
    let uploadedBannerUrl = '';
    const uploadedFiles = [];
    if (req.file) uploadedFiles.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) uploadedFiles.push(...req.files);
      else uploadedFiles.push(...Object.values(req.files).flat());
    }
    for (const f of uploadedFiles) {
      const mime = (f.mimetype || '').toLowerCase();
      if (mime.startsWith('image/') && f.secure_url && f.secure_url.startsWith('http')) {
        uploadedBannerUrl = f.secure_url;
        console.log(`[IMAGE UPLOAD] Course banner image received: filename="${f.originalname}", MIME="${mime}", size=${f.size || 0}, secure_url="${uploadedBannerUrl}"`);
        break;
      }
    }

    const actualThumbnail =
      uploadedBannerUrl || thumbnail || banner || bannerUrl || thumbnailUrl || image || imageUrl || courseBanner || '';

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
    if (uploadedBannerUrl) {
      deleteCloudinaryByUrl(uploadedBannerUrl).catch(err => console.error('Failed to cleanup banner on create failure:', err));
    }
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

    // Extract banner URL from uploaded file if present (multipart image upload from Flutter admin)
    let uploadedBannerUrl = '';
    const uploadedFiles = [];
    if (req.file) uploadedFiles.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) uploadedFiles.push(...req.files);
      else uploadedFiles.push(...Object.values(req.files).flat());
    }
    for (const f of uploadedFiles) {
      const mime = (f.mimetype || '').toLowerCase();
      if (mime.startsWith('image/') && f.secure_url && f.secure_url.startsWith('http')) {
        uploadedBannerUrl = f.secure_url;
        console.log(`[IMAGE UPLOAD] Course banner update image received: filename="${f.originalname}", MIME="${mime}", size=${f.size || 0}, secure_url="${uploadedBannerUrl}"`);
        break;
      }
    }

    const effectiveBanner = uploadedBannerUrl || bannerVal;
    
    // Check if we are replacing an existing banner
    const oldCourse = await Course.findOne(query);
    if (!oldCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    const oldBanner = oldCourse.courseBanner || oldCourse.thumbnail || oldCourse.bannerUrl;

    if (effectiveBanner && oldBanner && effectiveBanner !== oldBanner) {
      updateData.thumbnail = effectiveBanner;
      updateData.bannerUrl = effectiveBanner;
      updateData.courseBanner = effectiveBanner;
      // Delete old banner asynchronously to prevent blocking
      deleteCloudinaryByUrl(oldBanner).catch(err => console.error('Failed to delete old course banner:', err));
    } else if (effectiveBanner) {
      updateData.thumbnail = effectiveBanner;
      updateData.bannerUrl = effectiveBanner;
      updateData.courseBanner = effectiveBanner;
    }

    const updatedCourse = await Course.findOneAndUpdate(query, updateData, { new: true, runValidators: true });

    const serialized = serializeCourse(updatedCourse, req);

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: serialized,
      course: serialized,
    });
  } catch (error) {
    if (uploadedBannerUrl) {
      deleteCloudinaryByUrl(uploadedBannerUrl).catch(err => console.error('Failed to cleanup banner on update failure:', err));
    }
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

    const bannerUrl = deletedCourse.courseBanner || deletedCourse.thumbnail || deletedCourse.bannerUrl;
    if (bannerUrl) {
      deleteCloudinaryByUrl(bannerUrl).catch(err => console.error('Failed to delete course banner on delete:', err));
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
    if (!course) {
      console.log('[getLessonsByModule] Course not found:', courseId);
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      console.log('[getLessonsByModule] Module not found:', moduleId);
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    const lessons = moduleItem.lessons.map((l) => serializeLesson(l, req));
    res.status(200).json({ success: true, message: 'Lessons fetched successfully', data: lessons });
  } catch (error) {
    console.error('Get Lessons Detailed Error:', {
      message: error.message,
      stack: error.stack,
      params: req.params
    });
    res.status(500).json({ success: false, message: 'Failed to fetch lessons', error: error.message });
  }
};

exports.addLesson = async (req, res) => {
  try {
    console.log('[addLesson] Step 1: Starting add lesson process');
    const { courseId, moduleId } = req.params;

    if (!isValidObjectId(moduleId)) {
      console.log('[addLesson] Step 1 failed: Invalid module ID format:', moduleId);
      return res.status(400).json({ success: false, message: 'Invalid module ID format' });
    }

    console.log('[addLesson] Step 2: Extracting request body fields');
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
      pdfFiles,
      assignments,
      assignmentFiles,
      attachments,
      uploadFileOrLink,
      fileOrLink,
      lessonFile,
      status,
    } = req.body;

    const actualLessonTitle = (lessonTitle || title || '').trim();
    if (!actualLessonTitle) {
      console.log('[addLesson] Step 2 failed: lessonTitle is missing');
      return res.status(400).json({ success: false, message: 'lessonTitle is required' });
    }

    console.log('[addLesson] Step 3: Finding course and module');
    const course = await findCourseByIdOrCustomId(courseId);
    if (!course) {
      console.log('[addLesson] Step 3 failed: Course not found:', courseId);
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const moduleItem = course.modules.id(moduleId);
    if (!moduleItem) {
      console.log('[addLesson] Step 3 failed: Module not found:', moduleId);
      return res.status(404).json({ success: false, message: 'Module not found' });
    }

    console.log('[addLesson] Step 4: Processing lesson type, links, and uploaded files');
    const actualLessonType = (lessonType || type || 'Recorded Video').trim();
    let actualMeetingUrl = (meetingUrl || '').trim();
    let finalVideoUrl = (videoUrl || '').trim();
    let finalVideoParts = parseFileItems(videoParts);
    let finalPdfNotes = parseFileItems(pdfNotes !== undefined ? pdfNotes : pdfFiles);
    let finalAssignments = parseFileItems(assignments !== undefined ? assignments : assignmentFiles);
    let finalAttachments = parseFileItems(attachments);

    const explicitCategoryMap = new Map();
    const registerExplicitCategory = (item, catName) => {
      if (!item || !catName) return;
      const key = getResourceKey(item);
      if (key) explicitCategoryMap.set(key, catName);
    };

    if (pdfNotes !== undefined || pdfFiles !== undefined) {
      finalPdfNotes.forEach((item) => registerExplicitCategory(item, 'pdfNotes'));
    }
    if (assignments !== undefined || assignmentFiles !== undefined) {
      finalAssignments.forEach((item) => registerExplicitCategory(item, 'assignments'));
    }
    if (attachments !== undefined) {
      finalAttachments.forEach((item) => registerExplicitCategory(item, 'attachments'));
    }
    if (videoParts !== undefined) {
      finalVideoParts.forEach((item) => registerExplicitCategory(item, 'videoParts'));
    }

    // Map legacy single link/file fields if provided
    const singleLink = (uploadFileOrLink || fileOrLink || lessonFile || '').trim();
    if (singleLink) {
      const explicitUploadType = (req.body.uploadType || req.body.upload_type || req.body.category || req.body.resourceCategory || '').toString().toLowerCase().trim();
      const lowerType = actualLessonType.toLowerCase();

      if (explicitUploadType === 'pdf_note' || explicitUploadType === 'pdfnotes' || explicitUploadType === 'pdf_notes' || explicitUploadType === 'pdf') {
        const item = { title: actualLessonTitle || 'PDF Notes', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalPdfNotes.some((p) => p.url === singleLink)) finalPdfNotes.push(item);
        registerExplicitCategory(item, 'pdfNotes');
      } else if (explicitUploadType === 'assignment' || explicitUploadType === 'assignments') {
        const item = { title: actualLessonTitle || 'Assignment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalAssignments.some((p) => p.url === singleLink)) finalAssignments.push(item);
        registerExplicitCategory(item, 'assignments');
      } else if (explicitUploadType === 'attachment' || explicitUploadType === 'attachments') {
        const item = { title: actualLessonTitle || 'Attachment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalAttachments.some((p) => p.url === singleLink)) finalAttachments.push(item);
        registerExplicitCategory(item, 'attachments');
      } else if (lowerType.includes('video') || lowerType === 'recorded video') {
        if (!finalVideoUrl) finalVideoUrl = singleLink;
        const item = { title: actualLessonTitle || 'Video Part 1', url: singleLink, secure_url: singleLink, resource_type: 'video' };
        if (!finalVideoParts.some((p) => p.url === singleLink)) finalVideoParts.push(item);
        registerExplicitCategory(item, 'videoParts');
      } else if (lowerType.includes('assign')) {
        const item = { title: actualLessonTitle || 'Assignment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalAssignments.some((p) => p.url === singleLink)) finalAssignments.push(item);
        registerExplicitCategory(item, 'assignments');
      } else if (lowerType.includes('pdf')) {
        const item = { title: actualLessonTitle || 'PDF Notes', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalPdfNotes.some((p) => p.url === singleLink)) finalPdfNotes.push(item);
        registerExplicitCategory(item, 'pdfNotes');
      } else if (lowerType.includes('live') || lowerType === 'link') {
        if (!actualMeetingUrl) actualMeetingUrl = singleLink;
      } else {
        const item = { title: actualLessonTitle || 'Attachment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!finalAttachments.some((p) => p.url === singleLink)) finalAttachments.push(item);
        registerExplicitCategory(item, 'attachments');
      }
    }

    // Map uploaded multipart files (streamed to Cloudinary or disk)
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    console.log(`[addLesson] req.file exists: ${Boolean(req.file)}, req.files count: ${filesList.length}`);
    filesList.forEach((f, i) => {
      console.log(`[addLesson] File #${i + 1}: originalname="${f.originalname || 'unknown'}", fieldname="${f.fieldname || 'unknown'}", mimetype="${f.mimetype || 'unknown'}", size=${f.size || (f.buffer ? f.buffer.length : 0)} bytes, secure_url="${f.secure_url || 'NONE'}"`);
    });

    // Safeguard: Ensure any video file has been uploaded to Cloudinary
    for (const f of filesList) {
      const fileMime = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
      const fileExt = path.extname(f.originalname || f.filename || '').toLowerCase().replace('.', '');
      const isVideoFile = fileMime.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt) || ((f.fieldname || '').toLowerCase().includes('video'));
      if (isVideoFile && (!f.secure_url || !f.secure_url.startsWith('http')) && (f.buffer || f.path) && isCloudinaryConfigured()) {
        console.log(`[addLesson] Video file found without Cloudinary URL, uploading now: "${f.originalname}"`);
        console.log('[VIDEO UPLOAD] File received');
        console.log(`[VIDEO UPLOAD] Filename: ${f.originalname || 'unknown'}`);
        console.log(`[VIDEO UPLOAD] MIME: ${fileMime || 'video/mp4'}`);
        console.log(`[VIDEO UPLOAD] Size: ${f.size || (f.buffer ? f.buffer.length : 0)}`);
        console.log('[VIDEO UPLOAD] Starting Cloudinary upload');
        try {
          const { cleanBaseName } = extractCleanNameAndExt(f.originalname, fileExt);
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          const uploaded = await uploadBufferToCloudinary(f, 'homeopathy-media/videos', {
            resource_type: 'video',
            public_id: `${cleanBaseName}-${uniqueSuffix}`,
            timeout: 600000,
            chunk_size: 6000000,
          });
          console.log('[VIDEO UPLOAD] Cloudinary upload successful');
          console.log(`[VIDEO UPLOAD] Resource type: ${uploaded.resource_type}`);
          console.log(`[VIDEO UPLOAD] Secure URL: ${uploaded.secure_url}`);
          f.secure_url = uploaded.secure_url;
          f.url = uploaded.secure_url;
          f.path = uploaded.secure_url;
          f.public_id = uploaded.public_id;
          f.resource_type = 'video';
        } catch (uploadErr) {
          console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${uploadErr.message || uploadErr}`);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload video to Cloudinary storage.',
            error: uploadErr.message,
          });
        }
      }
    }

    filesList.forEach((f) => {
      if (f && (f.secure_url || f.url || f.path || f.filename)) {
        const rawFileUrl = (f.secure_url && f.secure_url.startsWith('http'))
          ? f.secure_url
          : (f.url && f.url.startsWith('http'))
            ? f.url
            : (f.path && f.path.startsWith('http'))
              ? f.path
              : (f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : ''));
        const fileUrl = normalizeFileUrl(rawFileUrl);
        const fileTitle = f.originalname || f.filename || 'Resource';
        const field = (f.fieldname || '').toLowerCase();
        const fileMimeType = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
        const fileExt = path.extname(f.originalname || f.filename || '').toLowerCase().replace('.', '');
        const explicitFileCat = (f.uploadType || f.category || f.upload_type || req.body.uploadType || req.body.upload_type || req.body.category || req.body.resourceCategory || '').toString().toLowerCase().trim();

        let explicitResourceType = f.resource_type;
        if (!explicitResourceType) {
          if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
            explicitResourceType = 'video';
          } else if (fileMimeType === 'application/pdf' || fileExt === 'pdf' || ALLOWED_DOC_FORMATS.includes(fileExt)) {
            explicitResourceType = 'raw';
          } else {
            explicitResourceType = 'auto';
          }
        }

        const publicId = f.public_id || (fileUrl.includes('cloudinary.com') ? (getPublicIdFromUrl(fileUrl) || '') : '') || '';
        const secureUrl = (f.secure_url && f.secure_url.startsWith('http')) ? f.secure_url : fileUrl;

        const fileObj = {
          title: fileTitle,
          url: fileUrl,
          public_id: publicId,
          secure_url: secureUrl,
          resource_type: explicitResourceType,
          mimetype: fileMimeType,
          size: f.bytes || f.size || 0,
        };

        if (explicitFileCat === 'pdf_note' || explicitFileCat === 'pdfnotes' || explicitFileCat === 'pdf_notes' || field === 'pdfnotes' || field === 'pdfnote' || field === 'pdf_note' || field === 'pdf_notes' || field.startsWith('pdfnotes')) {
          finalPdfNotes.push(fileObj);
          registerExplicitCategory(fileObj, 'pdfNotes');
        } else if (explicitFileCat === 'assignment' || explicitFileCat === 'assignments' || field === 'assignments' || field === 'assignment' || field === 'assignmentfiles' || field === 'assignmentfile' || field.startsWith('assignment')) {
          finalAssignments.push(fileObj);
          registerExplicitCategory(fileObj, 'assignments');
        } else if (explicitFileCat === 'attachment' || explicitFileCat === 'attachments' || field === 'attachments' || field === 'attachment' || field.startsWith('attachment')) {
          finalAttachments.push(fileObj);
          registerExplicitCategory(fileObj, 'attachments');
        } else if (field === 'videourl' || field === 'video' || field === 'videofile') {
          finalVideoUrl = fileUrl;
          if (!finalVideoParts.some((p) => p.url === fileUrl)) {
            finalVideoParts.push(fileObj);
          }
          registerExplicitCategory(fileObj, 'videoParts');
        } else if (field === 'videoparts' || field === 'videopart' || field.startsWith('videoparts') || field === 'videos') {
          finalVideoParts.push(fileObj);
          if (!finalVideoUrl) finalVideoUrl = fileUrl;
          registerExplicitCategory(fileObj, 'videoParts');
        } else if (field === 'pdf' || field === 'pdffile' || field === 'pdffiles' || field === 'pdfs') {
          if (explicitFileCat === 'assignment' || actualLessonType.toLowerCase().includes('assign')) {
            finalAssignments.push(fileObj);
            registerExplicitCategory(fileObj, 'assignments');
          } else if (explicitFileCat === 'attachment') {
            finalAttachments.push(fileObj);
            registerExplicitCategory(fileObj, 'attachments');
          } else {
            finalPdfNotes.push(fileObj);
            registerExplicitCategory(fileObj, 'pdfNotes');
          }
        } else if (field === 'file' || field === 'lessonfile' || field === 'uploadfileorlink' || field === 'files') {
          if (actualLessonType.toLowerCase().includes('assign')) {
            finalAssignments.push(fileObj);
            registerExplicitCategory(fileObj, 'assignments');
          } else if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
            finalVideoUrl = fileUrl;
            if (!finalVideoParts.some((p) => p.url === fileUrl)) finalVideoParts.push(fileObj);
            registerExplicitCategory(fileObj, 'videoParts');
          } else {
            finalAttachments.push(fileObj);
            registerExplicitCategory(fileObj, 'attachments');
          }
        } else if (actualLessonType.toLowerCase().includes('assign')) {
          finalAssignments.push(fileObj);
          registerExplicitCategory(fileObj, 'assignments');
        } else if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
          finalVideoUrl = fileUrl;
          if (!finalVideoParts.some((p) => p.url === fileUrl)) finalVideoParts.push(fileObj);
          registerExplicitCategory(fileObj, 'videoParts');
        } else {
          finalAttachments.push(fileObj);
          registerExplicitCategory(fileObj, 'attachments');
        }
      }
    });

    // Filter out fake / placeholder Cloudinary URLs (such as hardcoded wrong cloud names like doxb5l5vf)
    finalVideoParts = finalVideoParts.filter((p) => {
      if (!p || !p.url) return false;
      if (p.url.includes('doxb5l5vf')) {
        console.warn(`[addLesson] Rejecting fake placeholder video URL with invalid cloud name doxb5l5vf: "${p.url}"`);
        return false;
      }
      return true;
    });

    if (finalVideoUrl && finalVideoUrl.includes('doxb5l5vf')) {
      console.warn(`[addLesson] Rejecting fake placeholder finalVideoUrl with invalid cloud name doxb5l5vf: "${finalVideoUrl}"`);
      finalVideoUrl = '';
    }

    const isRecordedVideoType = actualLessonType === 'Recorded Video' || actualLessonType === 'Video' || actualLessonType.toLowerCase() === 'video';
    if (isRecordedVideoType) {
      const hasUploadedVideo = filesList.some((f) => {
        const m = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
        const ext = path.extname(f.originalname || f.filename || '').toLowerCase().replace('.', '');
        return m.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(ext) || ((f.fieldname || '').toLowerCase().includes('video'));
      });
      const rawVideoProvided = (videoUrl || uploadFileOrLink || fileOrLink || lessonFile || '').trim();
      const isFakeOrRawFilename = rawVideoProvided && (!rawVideoProvided.startsWith('http://') && !rawVideoProvided.startsWith('https://') && !rawVideoProvided.startsWith('/uploads/'));
      if (isFakeOrRawFilename && !hasUploadedVideo) {
        return res.status(400).json({
          success: false,
          message: `Invalid video URL or file "${rawVideoProvided}". Please upload a video file or provide a valid streaming URL.`,
        });
      }
    }

    // Auto-sync videoUrl with videoParts if single video was provided
    if (finalVideoUrl && finalVideoParts.length === 0) {
      finalVideoParts.push({ title: actualLessonTitle || 'Video Part 1', url: finalVideoUrl, secure_url: finalVideoUrl, resource_type: 'video' });
    } else if (!finalVideoUrl && finalVideoParts.length > 0) {
      finalVideoUrl = finalVideoParts[0].url;
    }

    const isolated = sanitizeAndIsolateResourceArrays({
      videoParts: finalVideoParts,
      pdfNotes: finalPdfNotes,
      assignments: finalAssignments,
      attachments: finalAttachments,
      explicitCategoryMap,
    });
    finalVideoParts = isolated.videoParts;
    finalPdfNotes = isolated.pdfNotes;
    finalAssignments = isolated.assignments;
    finalAttachments = isolated.attachments;

    console.log('========== LESSON RESOURCE SAVE ==========');
    console.log(`pdfNotes count: ${finalPdfNotes.length}`);
    console.log(`assignments count: ${finalAssignments.length}`);
    console.log(`attachments count: ${finalAttachments.length}`);
    console.log('PDF NOTES:');
    console.log(JSON.stringify(finalPdfNotes, null, 2));
    console.log('ASSIGNMENTS:');
    console.log(JSON.stringify(finalAssignments, null, 2));
    console.log('ATTACHMENTS:');
    console.log(JSON.stringify(finalAttachments, null, 2));
    console.log('===========================================');

    const newLesson = {
      lessonTitle: actualLessonTitle,
      lessonType: actualLessonType,
      durationOrPages: (durationOrPages || duration || pages || '').trim(),
      description: (description || '').trim(),
      meetingUrl: actualMeetingUrl,
      videoUrl: finalVideoUrl,
      videoParts: finalVideoParts,
      pdfNotes: finalPdfNotes,
      assignments: finalAssignments,
      attachments: finalAttachments,
      status: (status || 'Published').trim(),
    };

    console.log('[addLesson] Step 5: Pushing new lesson to module and saving course');
    moduleItem.lessons.push(newLesson);
    await course.save();

    const saved = moduleItem.lessons[moduleItem.lessons.length - 1];
    console.log('[addLesson] Successfully added lesson with ID:', saved._id);
    return res.status(201).json({
      success: true,
      message: 'Lesson added successfully',
      data: serializeLesson(saved, req),
      lesson: serializeLesson(saved, req),
    });
  } catch (error) {
    // Cleanup uploaded files on failure
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }
    filesList.forEach(f => {
      if (f.secure_url) deleteCloudinaryByUrl(f.secure_url).catch(err => console.error('Cleanup failed:', err));
    });

    console.error("🔥 FULL DETAILED ERROR STACK (addLesson):", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      params: req.params,
      body: req.body
    });
    return res.status(500).json({ 
      success: false, 
      message: "Failed to add lesson", 
      error: error.message 
    });
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
      pdfFiles,
      assignments,
      assignmentFiles,
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
    const explicitCategoryMap = new Map();
    const registerExplicitCategory = (item, catName) => {
      if (!item || !catName) return;
      const key = getResourceKey(item);
      if (key) explicitCategoryMap.set(key, catName);
    };

    if (videoParts !== undefined) {
      targetLesson.videoParts = parseFileItems(videoParts);
      targetLesson.videoParts.forEach((item) => registerExplicitCategory(item, 'videoParts'));
    }
    if (pdfNotes !== undefined || pdfFiles !== undefined) {
      targetLesson.pdfNotes = parseFileItems(pdfNotes !== undefined ? pdfNotes : pdfFiles);
      targetLesson.pdfNotes.forEach((item) => registerExplicitCategory(item, 'pdfNotes'));
    }
    if (assignments !== undefined || assignmentFiles !== undefined) {
      targetLesson.assignments = parseFileItems(assignments !== undefined ? assignments : assignmentFiles);
      targetLesson.assignments.forEach((item) => registerExplicitCategory(item, 'assignments'));
    }
    if (attachments !== undefined) {
      targetLesson.attachments = parseFileItems(attachments);
      targetLesson.attachments.forEach((item) => registerExplicitCategory(item, 'attachments'));
    }

    // Map single link if provided
    const singleLink = (uploadFileOrLink || fileOrLink || lessonFile || '').trim();
    if (singleLink) {
      const explicitUploadType = (req.body.uploadType || req.body.upload_type || req.body.category || req.body.resourceCategory || '').toString().toLowerCase().trim();
      const lowerType = (targetLesson.lessonType || '').toLowerCase();

      if (explicitUploadType === 'pdf_note' || explicitUploadType === 'pdfnotes' || explicitUploadType === 'pdf_notes' || explicitUploadType === 'pdf') {
        const item = { title: targetLesson.lessonTitle || 'PDF Notes', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.pdfNotes.some((p) => p.url === singleLink)) targetLesson.pdfNotes.push(item);
        registerExplicitCategory(item, 'pdfNotes');
      } else if (explicitUploadType === 'assignment' || explicitUploadType === 'assignments') {
        const item = { title: targetLesson.lessonTitle || 'Assignment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.assignments.some((p) => p.url === singleLink)) targetLesson.assignments.push(item);
        registerExplicitCategory(item, 'assignments');
      } else if (explicitUploadType === 'attachment' || explicitUploadType === 'attachments') {
        const item = { title: targetLesson.lessonTitle || 'Attachment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.attachments.some((p) => p.url === singleLink)) targetLesson.attachments.push(item);
        registerExplicitCategory(item, 'attachments');
      } else if (lowerType.includes('video') || lowerType === 'recorded video') {
        targetLesson.videoUrl = singleLink;
        const item = { title: targetLesson.lessonTitle || 'Video Part', url: singleLink, secure_url: singleLink, resource_type: 'video' };
        if (!targetLesson.videoParts.some((p) => p.url === singleLink)) targetLesson.videoParts.push(item);
        registerExplicitCategory(item, 'videoParts');
      } else if (lowerType.includes('assign')) {
        const item = { title: targetLesson.lessonTitle || 'Assignment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.assignments.some((p) => p.url === singleLink)) targetLesson.assignments.push(item);
        registerExplicitCategory(item, 'assignments');
      } else if (lowerType.includes('pdf')) {
        const item = { title: targetLesson.lessonTitle || 'PDF Notes', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.pdfNotes.some((p) => p.url === singleLink)) targetLesson.pdfNotes.push(item);
        registerExplicitCategory(item, 'pdfNotes');
      } else if (lowerType.includes('live') || lowerType === 'link') {
        targetLesson.meetingUrl = singleLink;
      } else {
        const item = { title: targetLesson.lessonTitle || 'Attachment', url: singleLink, secure_url: singleLink, resource_type: 'raw' };
        if (!targetLesson.attachments.some((p) => p.url === singleLink)) targetLesson.attachments.push(item);
        registerExplicitCategory(item, 'attachments');
      }
    }

    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }

    console.log(`[updateLesson] req.file exists: ${Boolean(req.file)}, req.files count: ${filesList.length}`);
    filesList.forEach((f, i) => {
      console.log(`[updateLesson] File #${i + 1}: originalname="${f.originalname || 'unknown'}", fieldname="${f.fieldname || 'unknown'}", mimetype="${f.mimetype || 'unknown'}", size=${f.size || (f.buffer ? f.buffer.length : 0)} bytes, secure_url="${f.secure_url || 'NONE'}"`);
    });

    // Safeguard: Ensure any video file has been uploaded to Cloudinary
    for (const f of filesList) {
      const fileMime = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
      const fileExt = path.extname(f.originalname || f.filename || '').toLowerCase().replace('.', '');
      const isVideoFile = fileMime.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt) || ((f.fieldname || '').toLowerCase().includes('video'));
      if (isVideoFile && (!f.secure_url || !f.secure_url.startsWith('http')) && (f.buffer || f.path) && isCloudinaryConfigured()) {
        console.log(`[updateLesson] Video file found without Cloudinary URL, uploading now: "${f.originalname}"`);
        console.log('[VIDEO UPLOAD] File received');
        console.log(`[VIDEO UPLOAD] Filename: ${f.originalname || 'unknown'}`);
        console.log(`[VIDEO UPLOAD] MIME: ${fileMime || 'video/mp4'}`);
        console.log(`[VIDEO UPLOAD] Size: ${f.size || (f.buffer ? f.buffer.length : 0)}`);
        console.log('[VIDEO UPLOAD] Starting Cloudinary upload');
        try {
          const { cleanBaseName } = extractCleanNameAndExt(f.originalname, fileExt);
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          const uploaded = await uploadBufferToCloudinary(f, 'homeopathy-media/videos', {
            resource_type: 'video',
            public_id: `${cleanBaseName}-${uniqueSuffix}`,
            timeout: 600000,
            chunk_size: 6000000,
          });
          console.log('[VIDEO UPLOAD] Cloudinary upload successful');
          console.log(`[VIDEO UPLOAD] Resource type: ${uploaded.resource_type}`);
          console.log(`[VIDEO UPLOAD] Secure URL: ${uploaded.secure_url}`);
          f.secure_url = uploaded.secure_url;
          f.url = uploaded.secure_url;
          f.path = uploaded.secure_url;
          f.public_id = uploaded.public_id;
          f.resource_type = 'video';
        } catch (uploadErr) {
          console.error(`[VIDEO UPLOAD] Cloudinary upload FAILED: ${uploadErr.message || uploadErr}`);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload video to Cloudinary storage.',
            error: uploadErr.message,
          });
        }
      }
    }

    filesList.forEach((f) => {
      if (f && (f.secure_url || f.url || f.path || f.filename)) {
        const rawFileUrl = (f.secure_url && f.secure_url.startsWith('http'))
          ? f.secure_url
          : (f.url && f.url.startsWith('http'))
            ? f.url
            : (f.path && f.path.startsWith('http'))
              ? f.path
              : (f.secure_url || f.url || f.path || (f.filename ? `/uploads/${f.filename}` : ''));
        const fileUrl = normalizeFileUrl(rawFileUrl);
        const fileTitle = f.originalname || f.filename || 'Resource';
        const field = (f.fieldname || '').toLowerCase();
        const fileMimeType = (f.mimetype || (f.originalname ? mimeTypes.lookup(f.originalname) : '') || '').toLowerCase();
        const fileExt = path.extname(f.originalname || f.filename || '').toLowerCase().replace('.', '');
        const explicitFileCat = (f.uploadType || f.category || f.upload_type || req.body.uploadType || req.body.upload_type || req.body.category || req.body.resourceCategory || '').toString().toLowerCase().trim();

        let explicitResourceType = f.resource_type;
        if (!explicitResourceType) {
          if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
            explicitResourceType = 'video';
          } else if (fileMimeType === 'application/pdf' || fileExt === 'pdf' || ALLOWED_DOC_FORMATS.includes(fileExt)) {
            explicitResourceType = 'raw';
          } else {
            explicitResourceType = 'auto';
          }
        }

        const publicId = f.public_id || (fileUrl.includes('cloudinary.com') ? (getPublicIdFromUrl(fileUrl) || '') : '') || '';
        const secureUrl = (f.secure_url && f.secure_url.startsWith('http')) ? f.secure_url : fileUrl;

        const fileObj = {
          title: fileTitle,
          url: fileUrl,
          public_id: publicId,
          secure_url: secureUrl,
          resource_type: explicitResourceType,
          mimetype: fileMimeType,
          size: f.bytes || f.size || 0,
        };

        if (explicitFileCat === 'pdf_note' || explicitFileCat === 'pdfnotes' || explicitFileCat === 'pdf_notes' || field === 'pdfnotes' || field === 'pdfnote' || field === 'pdf_note' || field === 'pdf_notes' || field.startsWith('pdfnotes')) {
          targetLesson.pdfNotes.push(fileObj);
          registerExplicitCategory(fileObj, 'pdfNotes');
        } else if (explicitFileCat === 'assignment' || explicitFileCat === 'assignments' || field === 'assignments' || field === 'assignment' || field === 'assignmentfiles' || field === 'assignmentfile' || field.startsWith('assignment')) {
          targetLesson.assignments.push(fileObj);
          registerExplicitCategory(fileObj, 'assignments');
        } else if (explicitFileCat === 'attachment' || explicitFileCat === 'attachments' || field === 'attachments' || field === 'attachment' || field.startsWith('attachment')) {
          targetLesson.attachments.push(fileObj);
          registerExplicitCategory(fileObj, 'attachments');
        } else if (field === 'videourl' || field === 'video' || field === 'videofile') {
          targetLesson.videoUrl = fileUrl;
          if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) {
            targetLesson.videoParts.push(fileObj);
          }
          registerExplicitCategory(fileObj, 'videoParts');
        } else if (field === 'videoparts' || field === 'videopart' || field.startsWith('videoparts') || field === 'videos') {
          targetLesson.videoParts.push(fileObj);
          if (!targetLesson.videoUrl) targetLesson.videoUrl = fileUrl;
          registerExplicitCategory(fileObj, 'videoParts');
        } else if (field === 'pdf' || field === 'pdffile' || field === 'pdffiles' || field === 'pdfs') {
          if (explicitFileCat === 'assignment' || (targetLesson.lessonType || '').toLowerCase().includes('assign')) {
            targetLesson.assignments.push(fileObj);
            registerExplicitCategory(fileObj, 'assignments');
          } else if (explicitFileCat === 'attachment') {
            targetLesson.attachments.push(fileObj);
            registerExplicitCategory(fileObj, 'attachments');
          } else {
            targetLesson.pdfNotes.push(fileObj);
            registerExplicitCategory(fileObj, 'pdfNotes');
          }
        } else if (field === 'file' || field === 'lessonfile' || field === 'uploadfileorlink' || field === 'files') {
          if ((targetLesson.lessonType || '').toLowerCase().includes('assign')) {
            targetLesson.assignments.push(fileObj);
            registerExplicitCategory(fileObj, 'assignments');
          } else if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
            targetLesson.videoUrl = fileUrl;
            if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) targetLesson.videoParts.push(fileObj);
            registerExplicitCategory(fileObj, 'videoParts');
          } else {
            targetLesson.attachments.push(fileObj);
            registerExplicitCategory(fileObj, 'attachments');
          }
        } else if ((targetLesson.lessonType || '').toLowerCase().includes('assign')) {
          targetLesson.assignments.push(fileObj);
          registerExplicitCategory(fileObj, 'assignments');
        } else if (fileMimeType.startsWith('video/') || ALLOWED_VIDEO_FORMATS.includes(fileExt)) {
          targetLesson.videoUrl = fileUrl;
          if (!targetLesson.videoParts.some((p) => p.url === fileUrl)) targetLesson.videoParts.push(fileObj);
          registerExplicitCategory(fileObj, 'videoParts');
        } else {
          targetLesson.attachments.push(fileObj);
          registerExplicitCategory(fileObj, 'attachments');
        }
      }
    });

    // Filter out fake / placeholder Cloudinary URLs (such as hardcoded wrong cloud names like doxb5l5vf)
    if (targetLesson.videoParts && targetLesson.videoParts.length > 0) {
      targetLesson.videoParts = targetLesson.videoParts.filter((p) => {
        if (!p || !p.url) return false;
        if (p.url.includes('doxb5l5vf')) {
          console.warn(`[updateLesson] Rejecting fake placeholder video URL with invalid cloud name doxb5l5vf: "${p.url}"`);
          return false;
        }
        return true;
      });
    }

    if (targetLesson.videoUrl && targetLesson.videoUrl.includes('doxb5l5vf')) {
      console.warn(`[updateLesson] Rejecting fake placeholder videoUrl: "${targetLesson.videoUrl}"`);
      targetLesson.videoUrl = '';
    }

    if (targetLesson.videoUrl && targetLesson.videoParts.length === 0) {
      targetLesson.videoParts.push({ title: targetLesson.lessonTitle || 'Video Part 1', url: targetLesson.videoUrl, secure_url: targetLesson.videoUrl, resource_type: 'video' });
    }

    const isolated = sanitizeAndIsolateResourceArrays({
      videoParts: targetLesson.videoParts,
      pdfNotes: targetLesson.pdfNotes,
      assignments: targetLesson.assignments,
      attachments: targetLesson.attachments,
      explicitCategoryMap,
    });
    targetLesson.videoParts = isolated.videoParts;
    targetLesson.pdfNotes = isolated.pdfNotes;
    targetLesson.assignments = isolated.assignments;
    targetLesson.attachments = isolated.attachments;

    console.log('========== LESSON RESOURCE SAVE ==========');
    console.log(`pdfNotes count: ${targetLesson.pdfNotes.length}`);
    console.log(`assignments count: ${targetLesson.assignments.length}`);
    console.log(`attachments count: ${targetLesson.attachments.length}`);
    console.log('PDF NOTES:');
    console.log(JSON.stringify(targetLesson.pdfNotes, null, 2));
    console.log('ASSIGNMENTS:');
    console.log(JSON.stringify(targetLesson.assignments, null, 2));
    console.log('ATTACHMENTS:');
    console.log(JSON.stringify(targetLesson.attachments, null, 2));
    console.log('===========================================');

    await course.save();

    return res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: serializeLesson(targetLesson, req),
      lesson: serializeLesson(targetLesson, req),
    });
  } catch (error) {
    // Cleanup uploaded files on failure
    const filesList = [];
    if (req.file) filesList.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) filesList.push(...req.files);
      else filesList.push(...Object.values(req.files).flat());
    }
    filesList.forEach(f => {
      if (f.secure_url) deleteCloudinaryByUrl(f.secure_url).catch(err => console.error('Cleanup failed:', err));
    });

    console.error("🔥 FULL ERROR STACK (updateLesson):", error.stack || error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update lesson", 
      error: error.message 
    });
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
    if (Array.isArray(targetLesson.assignments)) {
      targetLesson.assignments.forEach((f) => {
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

exports.processAttachments = processAttachments;

// Forward recording functions for backward-compatibility with routes
const recordingController = require('./recordingController');
exports.getLiveRecords = recordingController.getLiveRecords;
exports.uploadRecording = recordingController.uploadRecording;
