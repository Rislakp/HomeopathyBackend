const Course = require('../models/Course');
const Student = require('../models/Student');
const LessonProgress = require('../models/LessonProgress');
const CourseProgress = require('../models/CourseProgress');
const ContentItemProgress = require('../models/ContentItemProgress');
const { verifyStudentCourseAccess } = require('../utils/courseAccessHelper');
const { logActivity } = require('../utils/activityLogger');

const isFiniteNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Helper to extract duration in seconds from various request payload formats:
 * - seconds fields (incrementSeconds, durationSeconds, activeTimeSeconds, watchTimeSeconds, etc.)
 * - hours fields (studyTimeHours, activeTimeHours)
 * - startTime & endTime timestamps
 */
function extractDurationSeconds(body) {
  if (!body || typeof body !== 'object') return 0;
  const directSeconds = [
    body.incrementSeconds,
    body.studyTimeSeconds,
    body.watchTimeSeconds,
    body.activeTimeSeconds,
    body.timeSpentSeconds,
    body.durationSeconds,
    body.elapsedSeconds,
    body.seconds,
    body.duration,
  ].find(isFiniteNonNegativeNumber);

  if (directSeconds !== undefined && directSeconds > 0) {
    return directSeconds;
  }

  const directHours = [body.activeTimeHours, body.studyTimeHours].find(isFiniteNonNegativeNumber);
  if (directHours !== undefined && directHours > 0) {
    return Math.round(directHours * 3600);
  }

  if (body.startTime && body.endTime) {
    const start = new Date(body.startTime).getTime();
    const end = new Date(body.endTime).getTime();
    if (!isNaN(start) && !isNaN(end) && end > start) {
      const diffSec = Math.round((end - start) / 1000);
      if (diffSec > 0 && diffSec <= 86400) {
        return diffSec;
      }
    }
  }

  return 0;
}

/**
 * Flatten every content item across all modules → lessons → resource arrays.
 * Returns one entry per actual learning item (videoPart, pdfNote, assignment, attachment).
 * Each item has a stable `itemId` — the resource subdocument's _id when present,
 * or a deterministic composite key for legacy items saved before _id was enabled.
 * If a lesson has no sub-resource arrays, it is counted as 1 standalone item.
 */
function getCurriculumItems(course) {
  const items = [];
  const RESOURCE_ARRAYS = ['videoParts', 'pdfNotes', 'assignments', 'attachments'];

  // Canonical itemType labels (singular, stored in ContentItemProgress.itemType)
  const ITEM_TYPE_MAP = {
    videoParts:   'videoPart',
    pdfNotes:     'pdfNote',
    assignments:  'assignment',
    attachments:  'attachment',
  };

  for (const module of (course.modules || [])) {
    const moduleId = module._id ? module._id.toString() : String(module.id || '');
    for (const lesson of (module.lessons || [])) {
      const lessonId = lesson._id ? lesson._id.toString() : String(lesson.id || '');
      let hasSubResources = false;
      for (const arrayKey of RESOURCE_ARRAYS) {
        const resources = lesson[arrayKey];
        if (!Array.isArray(resources) || resources.length === 0) continue;
        hasSubResources = true;
        resources.forEach((resource, idx) => {
          // Prefer MongoDB-generated _id; fall back to composite key for legacy items
          const itemId = resource._id
            ? resource._id.toString()
            : `${lessonId}:${arrayKey}:${idx}`;
          items.push({
            moduleId,
            lessonId,
            itemId,
            itemType: ITEM_TYPE_MAP[arrayKey],
            arrayKey,
            item: resource,
            lesson,
          });
        });
      }

      if (!hasSubResources) {
        // Fallback for standalone/legacy lessons without subdocument resource arrays
        const type = (lesson.lessonType || '').toLowerCase();
        const itemType = type.includes('pdf')
          ? 'pdfNote'
          : type.includes('assign')
            ? 'assignment'
            : type.includes('attach')
              ? 'attachment'
              : 'videoPart';
        items.push({
          moduleId,
          lessonId,
          itemId: lessonId,
          itemType,
          arrayKey: 'legacy',
          item: lesson,
          lesson,
        });
      }
    }
  }
  return items;
}

/**
 * Build the progress summary for a course using ContentItemProgress records.
 * progressDocs must be an array of ContentItemProgress documents.
 * studyTimeSeconds is merged in separately from CourseProgress.
 */
function buildProgressSummary(course, contentProgressDocs, studyTimeSeconds = 0) {
  const curriculumItems = getCurriculumItems(course);

  // Completed content items matching current curriculum
  const completedCurriculumItems = curriculumItems.filter((ci) =>
    (contentProgressDocs || []).some(
      (doc) =>
        doc.completed === true &&
        (String(doc.itemId) === String(ci.itemId) ||
          (ci.item && (String(doc.itemId) === String(ci.item._id) || String(doc.itemId) === String(ci.item.id))) ||
          (!doc.itemId && String(doc.lessonId) === String(ci.lessonId)) ||
          (doc.itemId === doc.lessonId && String(doc.lessonId) === String(ci.lessonId)) ||
          (doc.lessonId && String(doc.lessonId) === String(ci.lessonId) && doc.itemType === ci.itemType))
    )
  );

  const completedItemIds = [...new Set(completedCurriculumItems.map((ci) => String(ci.itemId)))];
  const completedLessonIds = [...new Set(completedCurriculumItems.map((ci) => String(ci.lessonId)))];
  const completedItems = completedItemIds.length;
  const totalItems = curriculumItems.length;

  const progressRatio = totalItems === 0 ? 0 : Number((completedItems / totalItems).toFixed(4));
  const percentage = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);
  const progressPercentage = totalItems === 0 ? 0 : Number(((completedItems / totalItems) * 100).toFixed(2));
  const status =
    totalItems > 0 && completedItems === totalItems
      ? 'Completed'
      : completedItems > 0
        ? 'In Progress'
        : 'Not Started';

  return {
    courseId: course.courseId || (course._id ? course._id.toString() : ''),
    courseObjId: course._id ? course._id.toString() : '',
    totalItems,
    totalLessons: totalItems,        // alias kept for backward-compat
    completedItems,
    completedLessons: completedItems, // alias kept for backward-compat
    completedItemIds,
    completedLessonIds,
    remainingItems: Math.max(totalItems - completedItems, 0),
    remainingLessons: Math.max(totalItems - completedItems, 0),
    percentage,
    completionPercentage: percentage,
    progressPercentage,
    progress: progressRatio,
    status,
    // Study time comes from CourseProgress (accumulated separately)
    activeTimeSeconds: studyTimeSeconds,
    studyTimeSeconds,
    studyTimeHours: Number((studyTimeSeconds / 3600).toFixed(2)),
  };
}

async function resolveCourse(courseId) {
  if (/^[0-9a-fA-F]{24}$/.test(courseId)) {
    const byId = await Course.findById(courseId);
    if (byId) return byId;
  }
  return Course.findOne({ courseId });
}

/**
 * Persist a course-level progress summary to CourseProgress (the materialized cache).
 * contentProgressDocs = ContentItemProgress[] already fetched for this student+course.
 * Pass studyTimeSeconds explicitly to atomically set it; omit to retain the stored value.
 */
async function saveCourseSummary(studentId, course, contentProgressDocs, studyTimeSeconds) {
  // Resolve persisted study time first
  const existingCourseProgress = studyTimeSeconds === undefined
    ? await CourseProgress.findOne({ studentId, courseId: course._id }).lean()
    : null;
  const persistedStudyTime = studyTimeSeconds !== undefined
    ? studyTimeSeconds
    : (existingCourseProgress?.studyTimeSeconds || 0);

  const summary = buildProgressSummary(course, contentProgressDocs, persistedStudyTime);

  await CourseProgress.findOneAndUpdate(
    { studentId, courseId: course._id },
    {
      $set: {
        completedItemIds: summary.completedItemIds,
        totalItems: summary.totalItems,
        completedItems: summary.completedItems,
        completionPercentage: summary.completionPercentage,
        status: summary.status,
        studyTimeSeconds: persistedStudyTime,
        lastActivityAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return summary;
}

/**
 * Helper to find Student document from req.user
 */
async function resolveStudent(reqUser) {
  if (!reqUser) return null;
  const isObjId = (id) => id && require('mongoose').Types.ObjectId.isValid(id);

  // 1. Try finding by studentId if present in token
  if (isObjId(reqUser.studentId)) {
    const student = await Student.findById(reqUser.studentId);
    if (student) return student;
  }
  // 2. Try finding by userId FK
  const userId = reqUser.id || reqUser.userId;
  if (userId && isObjId(userId)) {
    let student = await Student.findOne({ userId });
    if (student) return student;
    student = await Student.findById(userId);
    if (student) return student;
  }
  // 3. Try finding by email
  if (reqUser.email) {
    const student = await Student.findOne({ email: reqUser.email.toLowerCase() });
    if (student) return student;
  }
  return null;
}

/**
 * Format course asset URLs to absolute URLs if relative
 */
function ensureAbsoluteUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const baseUrl = process.env.BASE_URL || 'https://homeopathybackend-1.onrender.com';
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  return `${baseUrl}${cleanUrl}`;
}

/**
 * Clean course object for student view (formats URLs)
 */
function formatCourseForStudent(courseDoc) {
  const course = courseDoc.toObject ? courseDoc.toObject({ virtuals: true }) : { ...courseDoc };

  if (course.thumbnail) course.thumbnail = ensureAbsoluteUrl(course.thumbnail);
  if (course.bannerUrl) course.bannerUrl = ensureAbsoluteUrl(course.bannerUrl);
  if (course.courseBanner) course.courseBanner = ensureAbsoluteUrl(course.courseBanner);

  if (Array.isArray(course.modules)) {
    course.modules = course.modules.map((mod) => {
      if (Array.isArray(mod.lessons)) {
        mod.lessons = mod.lessons.map((les) => {
          if (les.videoUrl) les.videoUrl = ensureAbsoluteUrl(les.videoUrl);
          if (les.meetingUrl) les.meetingUrl = ensureAbsoluteUrl(les.meetingUrl);

          ['videoParts', 'pdfNotes', 'assignments', 'attachments'].forEach((resKey) => {
            if (Array.isArray(les[resKey])) {
              les[resKey] = les[resKey].map((resItem) => {
                const canonical = resItem.secure_url || resItem.url || resItem.fileUrl || resItem.documentUrl || resItem.path || '';
                const absUrl = ensureAbsoluteUrl(canonical);
                return {
                  ...resItem,
                  url: absUrl,
                  secure_url: absUrl,
                  fileUrl: absUrl,
                  documentUrl: absUrl,
                  path: absUrl,
                };
              });
            }
          });

          const primaryDoc = (les.pdfNotes && les.pdfNotes[0]) || (les.attachments && les.attachments[0]) || (les.assignments && les.assignments[0]) || null;
          const primaryDocUrl = primaryDoc ? (primaryDoc.url || primaryDoc.secure_url || '') : '';
          const primaryLessonUrl = primaryDocUrl || les.videoUrl || '';

          les.fileUrl = primaryDocUrl || primaryLessonUrl;
          les.documentUrl = primaryDocUrl || primaryLessonUrl;
          les.pdfUrl = primaryDocUrl;
          les.path = primaryDocUrl || primaryLessonUrl;
          les.url = primaryDocUrl || primaryLessonUrl;

          return les;
        });
      }
      return mod;
    });
  }

  return course;
}

/**
 * GET /api/student/courses
 * Fetch list of available/enrolled courses for student
 */
const getMyCourses = async (req, res) => {
  try {
    const isStaff = ['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase());
    const student = isStaff ? null : await resolveStudent(req.user);

    let courses = [];
    if (isStaff) {
      courses = await Course.find({ status: 'Published' }).sort({ createdAt: -1 });
    } else {
      const courseRef = student?.courseRef || req.user?.courseRef;
      const courseId = student?.courseId || req.user?.courseId;
      const queryOr = [];

      if (courseRef && require('mongoose').Types.ObjectId.isValid(courseRef)) {
        queryOr.push({ _id: courseRef });
      } else if (courseId) {
        queryOr.push({ courseId: courseId });
      }

      if (queryOr.length > 0) {
        courses = await Course.find({ $or: queryOr, status: 'Published' });
      }
    }

    if (!isStaff && (!courses || courses.length === 0)) {
      return res.status(404).json({
        success: false,
        message: 'Registered course could not be loaded or is not assigned to student profile.',
        data: [],
        count: 0,
      });
    }

    const formatted = await Promise.all(courses.map(async (c) => {
      const formattedCourse = formatCourseForStudent(c);
      let totalLessons = 0;
      let totalModules = 0;
      if (Array.isArray(formattedCourse.modules)) {
        totalModules = formattedCourse.modules.length;
        totalLessons = formattedCourse.modules.reduce(
          (acc, m) => acc + (Array.isArray(m.lessons) ? m.lessons.length : 0),
          0
        );
      }

      // Default summary for unauthenticated / staff views
      const totalContentItems = getCurriculumItems(c).length;
      let summary = {
        totalItems: totalContentItems,
        totalLessons: totalContentItems,
        completedItems: 0,
        completedLessons: 0,
        completedItemIds: [],
        completedLessonIds: [],
        remainingItems: totalContentItems,
        remainingLessons: totalContentItems,
        percentage: 0,
        completionPercentage: 0,
        progressPercentage: 0,
        progress: 0,
        status: 'Not Started',
        activeTimeSeconds: 0,
        studyTimeSeconds: 0,
        studyTimeHours: 0,
      };

      if (student) {
        // Fetch content-item completion records (the source of truth for progress %)
        const contentProgressDocs = await ContentItemProgress.find({
          studentId: student._id,
          courseId: c._id,
        }).lean();
        // Merge persisted study time from CourseProgress
        const storedCourseProgress = await CourseProgress.findOne({ studentId: student._id, courseId: c._id }).lean();
        const studyTimeSec = storedCourseProgress?.studyTimeSeconds || 0;
        summary = buildProgressSummary(c, contentProgressDocs, studyTimeSec);
      }

      return {
        _id: formattedCourse._id,
        courseId: formattedCourse.courseId,
        courseTitle: formattedCourse.courseTitle || formattedCourse.title,
        shortDescription: formattedCourse.shortDescription || formattedCourse.description,
        instructor: formattedCourse.instructor,
        price: formattedCourse.price,
        category: formattedCourse.category,
        thumbnail: formattedCourse.thumbnail || formattedCourse.bannerUrl,
        bannerUrl: formattedCourse.bannerUrl,
        duration: formattedCourse.duration,
        modules: formattedCourse.modules || [],
        totalModules: Array.isArray(formattedCourse.modules) ? formattedCourse.modules.length : (c.modules ? c.modules.length : totalModules),
        totalLessons: summary.totalLessons,
        completedLessons: summary.completedLessons,
        completedLessonIds: summary.completedLessonIds,
        completedItemIds: summary.completedItemIds,
        completionPercentage: summary.completionPercentage,
        progressPercentage: summary.completionPercentage,
        percentage: summary.percentage,
        progress: summary.progress,
        status: summary.status,
        studyTimeSeconds: summary.studyTimeSeconds,
        studyTimeHours: summary.studyTimeHours,
        summary: summary,
        progressSummary: summary,
        createdAt: formattedCourse.createdAt,
      };
    }));

    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error('getMyCourses Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch student courses',
      error: error.message,
    });
  }
};

/**
 * GET /api/student/courses/:courseId/learn
 * Fetch full course curriculum with subscription gate verification
 */
const getMyCourseContent = async (req, res) => {
  try {
    const { courseId } = req.params;
    const isStaff = ['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase());

    // 1. Find target course by ObjectId or string courseId
    let course = null;
    if (courseId.match(/^[0-9a-fA-F]{24}$/)) {
      course = await Course.findById(courseId);
    }
    if (!course) {
      course = await Course.findOne({ courseId });
    }

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    let student = null;
    if (!isStaff) {
      student = await resolveStudent(req.user);

      if (!student) {
        return res.status(403).json({
          success: false,
          message: 'Student profile not found for this account',
        });
      }

      // Check account operational status
      const validAccountStatus = ['Active', 'Trial'];
      const accountStatusOk = validAccountStatus.includes(student.status) || student.isActive || student.isApproved;

      // Check subscription status
      const subStatusOk = ['Active', 'Trial'].includes(student.subscriptionStatus) || student.subscription === 'Active';

      if (!accountStatusOk && !subStatusOk) {
        return res.status(403).json({
          success: false,
          message: 'Active subscription or approved account status required to access course content',
          status: student.status,
          subscriptionStatus: student.subscriptionStatus,
        });
      }

      // Check expiration if set
      if (student.subscriptionExpiresAt && new Date(student.subscriptionExpiresAt) < new Date()) {
        return res.status(403).json({
          success: false,
          message: 'Your course subscription has expired',
          expiresAt: student.subscriptionExpiresAt,
        });
      }

      // Check specific courseRef assignment using helper
      const hasAccess = await verifyStudentCourseAccess(req.user, courseId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this specific course',
        });
      }
    }

    // 2. Fetch progress records if student
    //    lessonProgressMap  — used for per-lesson video position / pdf flags in the response
    //    contentProgressDocs — source of truth for item-based completion percentage
    let progressMap = {};
    let summary = null;
    if (student) {
      // Lesson-level detail (video position, pdf flags) — kept for UI progress indicators
      const lessonProgressDocs = await LessonProgress.find({
        studentId: student._id,
        courseId: course._id,
      });
      lessonProgressDocs.forEach((p) => {
        progressMap[p.lessonId] = {
          videoWatched: p.videoWatched,
          completed: p.completed || false,
          videoProgress: p.videoProgress,
          videoDuration: p.videoDuration,
          watchedPercent: p.watchedPercent,
          activeTimeSeconds: p.activeTimeSeconds || 0,
          completedAt: p.completedAt,
          pdfDownloaded: p.pdfDownloaded,
          pdfDownloadedAt: p.pdfDownloadedAt,
          pdfViewed: p.pdfViewed,
          pdfViewedAt: p.pdfViewedAt,
          lastAccessedAt: p.lastAccessedAt,
        };
      });

      // Content-item completion — authoritative source for progress percentage
      const contentProgressDocs = await ContentItemProgress.find({
        studentId: student._id,
        courseId: course._id,
      }).lean();

      // Persist and return the updated summary
      summary = await saveCourseSummary(student._id, course, contentProgressDocs);
    } else {
      const curriculumItems = getCurriculumItems(course);
      summary = {
        totalItems: curriculumItems.length,
        totalLessons: curriculumItems.length,
        completedItems: 0,
        completedLessons: 0,
        completedItemIds: [],
        completedLessonIds: [],
        remainingItems: curriculumItems.length,
        remainingLessons: curriculumItems.length,
        percentage: 0,
        completionPercentage: 0,
        progressPercentage: 0,
        progress: 0,
        status: 'Not Started',
        activeTimeSeconds: 0,
        studyTimeSeconds: 0,
        studyTimeHours: 0,
      };
    }

    // 3. Format full curriculum with absolute URLs and attached progress
    const formattedCourse = formatCourseForStudent(course);
    if (Array.isArray(formattedCourse.modules)) {
      formattedCourse.modules = formattedCourse.modules.map((mod) => ({
        ...mod,
        lessons: (mod.lessons || []).map((les) => ({
          ...les,
          progress: progressMap[les._id ? les._id.toString() : les.id] || {
            videoWatched: false,
            completed: false,
            videoProgress: 0,
            videoDuration: 0,
            watchedPercent: 0,
            activeTimeSeconds: 0,
            completedAt: null,
            pdfDownloaded: false,
            pdfDownloadedAt: null,
            pdfViewed: false,
            pdfViewedAt: null,
          },
        })),
      }));
    }

    formattedCourse.summary = summary;
    formattedCourse.progressSummary = summary;
    formattedCourse.completedLessonIds = summary.completedLessonIds;
    formattedCourse.completedItemIds = summary.completedItemIds;
    formattedCourse.completedLessons = summary.completedLessons;
    formattedCourse.totalLessons = summary.totalLessons;
    formattedCourse.completionPercentage = summary.completionPercentage;
    formattedCourse.progressPercentage = summary.completionPercentage;
    formattedCourse.percentage = summary.percentage;
    formattedCourse.progress = summary.progress;
    formattedCourse.status = summary.status;
    formattedCourse.studyTimeSeconds = summary.studyTimeSeconds;
    formattedCourse.studyTimeHours = summary.studyTimeHours;

    return res.status(200).json({
      success: true,
      data: {
        course: formattedCourse,
        progress: progressMap,
        summary: summary,
        progressSummary: summary,
        completedLessonIds: summary.completedLessonIds,
        completedItemIds: summary.completedItemIds,
        completedLessons: summary.completedLessons,
        totalLessons: summary.totalLessons,
        completedItems: summary.completedItems,
        totalItems: summary.totalItems,
        completionPercentage: summary.completionPercentage,
        progressPercentage: summary.completionPercentage,
        percentage: summary.percentage,
        progress: summary.progress,
        status: summary.status,
        studyTimeSeconds: summary.studyTimeSeconds,
        studyTimeHours: summary.studyTimeHours,
      },
      summary: summary,
      progressSummary: summary,
      completedLessonIds: summary.completedLessonIds,
      completedItemIds: summary.completedItemIds,
      completionPercentage: summary.completionPercentage,
      progressPercentage: summary.completionPercentage,
      percentage: summary.percentage,
      progress: summary.progress,
      totalLessons: summary.totalLessons,
      completedLessons: summary.completedLessons,
      status: summary.status,
    });
  } catch (error) {
    console.error('getMyCourseContent Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch course content',
      error: error.message,
    });
  }
};

/**
 * PATCH /api/student/courses/:courseId/modules/:moduleId/lessons/:lessonId/progress
 * Save or update lesson watching / reading progress
 */
const updateLessonProgress = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.params;
    const {
      videoProgress,
      videoDuration,
      videoWatched,
      pdfDownloaded,
      pdfViewed,
      viewedPdf,
      completed,
      lessonCompleted,
    } = req.body;

    const student = await resolveStudent(req.user);
    if (!student && !['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Student profile required to track progress',
      });
    }

    const course = await resolveCourse(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Identify all curriculum items belonging to this lesson
    const allCurriculumItems = getCurriculumItems(course);
    const lessonItems = allCurriculumItems.filter(
      (item) => item.moduleId === String(moduleId) && item.lessonId === String(lessonId)
    );
    if (lessonItems.length === 0) {
      return res.status(404).json({ success: false, message: 'Lesson not found in this course module' });
    }

    const hasAccess = await verifyStudentCourseAccess(req.user, courseId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this specific course',
      });
    }

    const studentIdToUse = student ? student._id : req.user.id;

    const existingProgress = await LessonProgress.findOne({
      studentId: studentIdToUse,
      courseId: course._id,
      lessonId: String(lessonId),
    });

    // Calculate percent from the supplied position without resetting a prior
    // duration or a previously completed lesson on partial follow-up events.
    let percent = 0;
    const duration = isFiniteNonNegativeNumber(videoDuration) && videoDuration > 0
      ? videoDuration
      : (existingProgress?.videoDuration || 0);
    const currentProgress = isFiniteNonNegativeNumber(videoProgress)
      ? videoProgress
      : (existingProgress?.videoProgress || 0);

    if (duration > 0) {
      percent = Math.min(100, Math.round((currentProgress / duration) * 100));
    } else if (videoWatched === true) {
      percent = 100;
    }

    const isPdfViewed = pdfViewed === true || viewedPdf === true || pdfDownloaded === true;
    const isCompleted = percent >= 90 || videoWatched === true || isPdfViewed || completed === true || lessonCompleted === true;

    // Study time handling: extract explicit duration from body or videoProgress delta
    const extractedSeconds = extractDurationSeconds(req.body);
    const videoProgressDelta = isFiniteNonNegativeNumber(videoProgress)
      ? Math.max(0, currentProgress - (existingProgress?.videoProgress || 0))
      : 0;
    const activeDeltaSeconds = extractedSeconds > 0 ? extractedSeconds : videoProgressDelta;

    const updateFields = {
      lastAccessedAt: new Date(),
    };

    if (isFiniteNonNegativeNumber(videoProgress)) updateFields.videoProgress = Math.max(currentProgress, existingProgress?.videoProgress || 0);
    if (duration > 0) updateFields.videoDuration = duration;
    if (percent > 0) updateFields.watchedPercent = Math.max(percent, existingProgress?.watchedPercent || 0);
    if (activeDeltaSeconds > 0) updateFields.activeTimeSeconds = (existingProgress?.activeTimeSeconds || 0) + activeDeltaSeconds;

    if (isCompleted) {
      updateFields.completed = true;
      if (percent >= 90 || videoWatched === true) updateFields.videoWatched = true;
      updateFields.completedAt = existingProgress?.completedAt || new Date();
    }

    if (pdfDownloaded === true) {
      updateFields.pdfDownloaded = true;
      updateFields.pdfDownloadedAt = existingProgress?.pdfDownloadedAt || new Date();
    }
    if (isPdfViewed) {
      updateFields.pdfViewed = true;
      updateFields.pdfViewedAt = existingProgress?.pdfViewedAt || new Date();
    }

    const progress = await LessonProgress.findOneAndUpdate(
      { studentId: studentIdToUse, courseId: course._id, lessonId },
      { $set: updateFields, $setOnInsert: { moduleId } },
      { new: true, upsert: true }
    );

    // Atomically increment CourseProgress studyTimeSeconds if active time was spent
    if (activeDeltaSeconds > 0) {
      await CourseProgress.findOneAndUpdate(
        { studentId: studentIdToUse, courseId: course._id },
        {
          $inc: { studyTimeSeconds: activeDeltaSeconds },
          $set: { lastActivityAt: new Date() },
          $setOnInsert: { totalItems: allCurriculumItems.length },
        },
        { upsert: true, new: true }
      );
    }

    // If lesson or its media is completed, mark corresponding ContentItemProgress items as completed
    if (isCompleted) {
      const now = new Date();
      await ContentItemProgress.bulkWrite(
        lessonItems.map((ci) => ({
          updateOne: {
            filter: { studentId: studentIdToUse, courseId: course._id, itemId: ci.itemId },
            update: {
              $set: {
                moduleId,
                lessonId,
                itemType: ci.itemType,
                completed: true,
                completedAt: now,
                lastAccessedAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
    }

    const wasCompleted = Boolean(existingProgress?.completed || existingProgress?.videoWatched || existingProgress?.pdfViewed || existingProgress?.pdfDownloaded || existingProgress?.completedAt);
    const action = isCompleted && !wasCompleted
      ? 'lesson_completed'
      : isPdfViewed
        ? 'pdf_viewed'
        : videoWatched === true
          ? 'video_watched'
          : 'lesson_progressed';
    const studentName = student?.name || student?.fullName || student?.email || 'A student';

    await logActivity({
      title: action === 'lesson_completed' ? 'Lesson completed' : action === 'pdf_viewed' ? 'PDF viewed' : 'Lesson activity',
      description: `${studentName} ${action === 'lesson_completed' ? 'completed' : action === 'pdf_viewed' ? 'viewed material in' : 'continued'} ${lessonItems[0]?.lesson?.lessonTitle || 'a lesson'} in ${course.courseTitle || 'a course'}`,
      type: 'student_learning',
      action,
      actor: studentIdToUse,
      courseId: course._id,
      moduleId: String(moduleId),
      lessonId: String(lessonId),
      metadata: { activeTimeSeconds: activeDeltaSeconds, watchedPercent: progress.watchedPercent || 0 },
    });

    const allContentDocs = await ContentItemProgress.find({ studentId: studentIdToUse, courseId: course._id }).lean();
    const summary = await saveCourseSummary(studentIdToUse, course, allContentDocs);
    return res.status(200).json({
      success: true,
      message: 'Lesson progress updated',
      data: progress,
      summary,
      progressSummary: summary,
      completedLessonIds: summary.completedLessonIds,
      completedItemIds: summary.completedItemIds,
      completedLessons: summary.completedLessons,
      totalLessons: summary.totalLessons,
      completedItems: summary.completedItems,
      totalItems: summary.totalItems,
      completionPercentage: summary.completionPercentage,
      progressPercentage: summary.progressPercentage,
      percentage: summary.percentage,
      progress: summary.progress,
      status: summary.status,
      studyTimeSeconds: summary.studyTimeSeconds,
      studyTimeHours: summary.studyTimeHours,
    });
  } catch (error) {
    console.error('updateLessonProgress Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update lesson progress',
      error: error.message,
    });
  }
};

/**
 * POST /api/courses/:courseId/progress
 * Persist a batch of completed curriculum item IDs.
 */
const saveCourseProgress = async (req, res) => {
  try {
    const student = await resolveStudent(req.user);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile required to track progress' });

    const course = await resolveCourse(req.params.courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
    if (!await verifyStudentCourseAccess(req.user, req.params.courseId)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this specific course' });
    }

    const requestedIds = [
      req.body.completedItemIds,
      req.body.completedLessonIds,
      req.body.completedVideoIds,
      req.body.completedDocumentIds,
      req.body.lessonId,
      req.body.videoId,
      req.body.documentId,
    ].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map(String);
    
    const allCurriculumItems = getCurriculumItems(course);
    const curriculumByItemId = new Map(allCurriculumItems.map((item) => [String(item.itemId), item]));
    const curriculumByLessonId = new Map(allCurriculumItems.map((item) => [String(item.lessonId), item]));
    
    const matchedItems = [...new Set(requestedIds)]
      .flatMap((id) => {
        const itemById = curriculumByItemId.get(id);
        if (itemById) return [itemById];
        // If id is a lessonId, find all items belonging to that lesson
        const itemsForLesson = allCurriculumItems.filter((ci) => String(ci.lessonId) === id);
        return itemsForLesson;
      })
      .filter(Boolean);

    if (requestedIds.length > 0 && matchedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No submitted item IDs belong to this course curriculum' });
    }

    const now = new Date();
    if (matchedItems.length > 0) {
      // 1. Bulk update ContentItemProgress
      await ContentItemProgress.bulkWrite(matchedItems.map((item) => ({
        updateOne: {
          filter: { studentId: student._id, courseId: course._id, itemId: item.itemId },
          update: {
            $set: {
              moduleId: item.moduleId,
              lessonId: item.lessonId,
              itemType: item.itemType,
              completed: true,
              completedAt: now,
              lastAccessedAt: now,
            },
          },
          upsert: true,
        },
      })));

      // 2. Also sync LessonProgress
      const uniqueLessonMap = new Map(matchedItems.map((item) => [item.lessonId, item]));
      await LessonProgress.bulkWrite([...uniqueLessonMap.values()].map((item) => ({
        updateOne: {
          filter: { studentId: student._id, courseId: course._id, lessonId: item.lessonId },
          update: { $set: { moduleId: item.moduleId, completed: true, completedAt: now, lastAccessedAt: now } },
          upsert: true,
        },
      })));
    }

    const allContentDocs = await ContentItemProgress.find({ studentId: student._id, courseId: course._id }).lean();
    const summary = await saveCourseSummary(student._id, course, allContentDocs);
    await logActivity({
      title: 'Course progress updated',
      description: `${student.name || student.email || 'A student'} marked ${matchedItems.length} curriculum item${matchedItems.length === 1 ? '' : 's'} complete in ${course.courseTitle || 'a course'}`,
      type: 'student_learning',
      action: req.body.action || 'course_progress_updated',
      actor: student._id,
      courseId: course._id,
      metadata: { completedItemIds: matchedItems.map((item) => item.itemId) },
    });
    return res.status(200).json({
      success: true,
      data: summary,
      summary,
      progressSummary: summary,
      completedLessonIds: summary.completedLessonIds,
      completedItemIds: summary.completedItemIds,
      completedLessons: summary.completedLessons,
      totalLessons: summary.totalLessons,
      completedItems: summary.completedItems,
      totalItems: summary.totalItems,
      completionPercentage: summary.completionPercentage,
      progressPercentage: summary.progressPercentage,
      percentage: summary.percentage,
      progress: summary.progress,
      status: summary.status,
      studyTimeSeconds: summary.studyTimeSeconds,
      studyTimeHours: summary.studyTimeHours,
    });
  } catch (error) {
    console.error('saveCourseProgress Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save course progress', error: error.message });
  }
};

/** POST /api/courses/:courseId/study-time - atomically add a session increment. */
const addStudyTime = async (req, res) => {
  try {
    const student = await resolveStudent(req.user);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile required to track study time' });
    const course = await resolveCourse(req.params.courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
    if (!await verifyStudentCourseAccess(req.user, req.params.courseId)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this specific course' });
    }
    
    const increment = extractDurationSeconds(req.body);
    if (increment <= 0 || increment > 86400) {
      return res.status(400).json({ success: false, message: 'A valid study-time increment between 1 and 86400 seconds is required' });
    }

    const courseProgress = await CourseProgress.findOneAndUpdate(
      { studentId: student._id, courseId: course._id },
      {
        $inc: { studyTimeSeconds: increment },
        $set: { lastActivityAt: new Date() },
        // Set totalItems on insert using the content-item count (not lesson count)
        $setOnInsert: { totalItems: getCurriculumItems(course).length },
      },
      { new: true, upsert: true }
    );
    await logActivity({
      title: 'Study time recorded',
      description: `${student.name || student.email || 'A student'} studied ${increment} seconds in ${course.courseTitle || 'a course'}`,
      type: 'student_learning', action: req.body.action || 'study_time_recorded', actor: student._id, courseId: course._id,
      metadata: { incrementSeconds: increment },
    });
    return res.status(200).json({ success: true, data: { studyTimeSeconds: courseProgress.studyTimeSeconds, studyTimeHours: Number((courseProgress.studyTimeSeconds / 3600).toFixed(2)) } });
  } catch (error) {
    console.error('addStudyTime Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to add study time', error: error.message });
  }
};

/**
 * GET /api/student/courses/:courseId/progress
 * Fetch overall progress list for a course
 */
const getMyProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const student = await resolveStudent(req.user);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found',
      });
    }

    const course = await resolveCourse(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const hasAccess = await verifyStudentCourseAccess(req.user, courseId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this specific course',
      });
    }

    // Content-item completion is the authoritative source for the progress summary
    const contentProgressDocs = await ContentItemProgress.find({
      studentId: student._id,
      courseId: course._id,
    }).lean();

    const storedCourseProgress = await CourseProgress.findOne({ studentId: student._id, courseId: course._id }).lean();
    const persistedStudyTime = storedCourseProgress?.studyTimeSeconds || 0;
    const summary = await saveCourseSummary(student._id, course, contentProgressDocs, persistedStudyTime);

    return res.status(200).json({
      success: true,
      courseId: course.courseId || course._id.toString(),
      courseObjId: course._id.toString(),
      count: contentProgressDocs.length,
      data: contentProgressDocs,
      summary,
      progressSummary: summary,
      completedLessonIds: summary.completedLessonIds,
      completedItemIds: summary.completedItemIds,
      totalItems: summary.totalItems,
      totalLessons: summary.totalLessons,
      completedItems: summary.completedItems,
      completedLessons: summary.completedLessons,
      percentage: summary.percentage,
      completionPercentage: summary.completionPercentage,
      progressPercentage: summary.progressPercentage,
      progress: summary.progress,
      status: summary.status,
      studyTimeSeconds: summary.studyTimeSeconds,
      studyTimeHours: summary.studyTimeHours,
    });
  } catch (error) {
    console.error('getMyProgress Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch course progress',
      error: error.message,
    });
  }
};

/**
 * PATCH /api/student/courses/:courseId/modules/:moduleId/lessons/:lessonId/items/:itemId/progress
 * Mark a specific content item (videoPart, pdfNote, assignment, attachment) as completed.
 *
 * Body:
 *   { itemType: 'videoPart'|'pdfNote'|'assignment'|'attachment', completed: true, durationSeconds: ..., activeTimeSeconds: ..., startTime: ..., endTime: ... }
 *
 * Response includes the updated course-level progress summary.
 */
const updateContentItemProgress = async (req, res) => {
  try {
    const { courseId, moduleId, lessonId, itemId } = req.params;
    const { itemType, completed } = req.body;

    const student = await resolveStudent(req.user);
    if (!student && !['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ success: false, message: 'Student profile required to track progress' });
    }

    const course = await resolveCourse(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    // Validate that the itemId actually belongs to this course's curriculum
    const allItems = getCurriculumItems(course);
    const targetItem = allItems.find(
      (ci) =>
        String(ci.itemId) === String(itemId) ||
        (ci.item && (String(ci.item._id) === String(itemId) || String(ci.item.id) === String(itemId))) ||
        (ci.lessonId === String(lessonId) && ci.moduleId === String(moduleId) && String(ci.itemId) === String(itemId)) ||
        (ci.lessonId === String(lessonId) && (String(ci.itemId).endsWith(':' + itemId) || String(itemId).includes(ci.arrayKey || ''))) ||
        (ci.lessonId === String(lessonId) && ci.item && (ci.item.title === itemId || ci.item.url === itemId || ci.item.public_id === itemId))
    );
    if (!targetItem) {
      return res.status(404).json({
        success: false,
        message: 'Content item not found in this course module/lesson',
      });
    }

    const hasAccess = await verifyStudentCourseAccess(req.user, courseId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'You do not have access to this specific course' });
    }

    const studentIdToUse = student ? student._id : req.user.id;
    const resolvedItemType = itemType || targetItem.itemType;
    const isCompleted = completed !== false; // default true if not specified

    // Extract study time / duration if sent
    const activeSeconds = extractDurationSeconds(req.body);
    if (activeSeconds > 0) {
      await CourseProgress.findOneAndUpdate(
        { studentId: studentIdToUse, courseId: course._id },
        {
          $inc: { studyTimeSeconds: activeSeconds },
          $set: { lastActivityAt: new Date() },
          $setOnInsert: { totalItems: allItems.length },
        },
        { upsert: true, new: true }
      );
    }

    const updateFields = {
      moduleId: targetItem.moduleId,
      lessonId: targetItem.lessonId,
      itemType: resolvedItemType,
      lastAccessedAt: new Date(),
    };
    if (isCompleted) {
      updateFields.completed = true;
      updateFields.completedAt = new Date();
    }

    await ContentItemProgress.findOneAndUpdate(
      { studentId: studentIdToUse, courseId: course._id, itemId: targetItem.itemId },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    // Also synchronize LessonProgress if applicable
    if (isCompleted) {
      const lessonUpdate = { lastAccessedAt: new Date() };
      if (resolvedItemType === 'videoPart') {
        lessonUpdate.videoWatched = true;
      } else if (resolvedItemType === 'pdfNote') {
        lessonUpdate.pdfViewed = true;
        lessonUpdate.pdfViewedAt = new Date();
      }
      await LessonProgress.findOneAndUpdate(
        { studentId: studentIdToUse, courseId: course._id, lessonId: targetItem.lessonId },
        { $set: lessonUpdate, $setOnInsert: { moduleId: targetItem.moduleId } },
        { upsert: true }
      );
    }

    // Re-fetch all content-item docs and recompute the course summary
    const allContentProgress = await ContentItemProgress.find({
      studentId: studentIdToUse,
      courseId: course._id,
    }).lean();
    const summary = await saveCourseSummary(studentIdToUse, course, allContentProgress);

    const studentName = student?.name || student?.fullName || student?.email || 'A student';
    await logActivity({
      title: isCompleted ? 'Content item completed' : 'Content item progress updated',
      description: `${studentName} ${isCompleted ? 'completed' : 'interacted with'} a ${resolvedItemType} in ${course.courseTitle || 'a course'}`,
      type: 'student_learning',
      action: isCompleted ? 'content_item_completed' : 'content_item_progressed',
      actor: studentIdToUse,
      courseId: course._id,
      moduleId: targetItem.moduleId,
      lessonId: targetItem.lessonId,
      metadata: { itemId: targetItem.itemId, itemType: resolvedItemType, activeTimeSeconds: activeSeconds },
    });

    return res.status(200).json({
      success: true,
      message: 'Content item progress updated',
      itemId: targetItem.itemId,
      itemType: resolvedItemType,
      completed: isCompleted,
      summary,
      progressSummary: summary,
      completedItemIds: summary.completedItemIds,
      completedLessonIds: summary.completedLessonIds,
      completedItems: summary.completedItems,
      totalItems: summary.totalItems,
      completionPercentage: summary.completionPercentage,
      progressPercentage: summary.progressPercentage,
      percentage: summary.percentage,
      progress: summary.progress,
      status: summary.status,
      studyTimeSeconds: summary.studyTimeSeconds,
      studyTimeHours: summary.studyTimeHours,
    });
  } catch (error) {
    console.error('updateContentItemProgress Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update content item progress',
      error: error.message,
    });
  }
};

module.exports = {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  saveCourseProgress,
  addStudyTime,
  getMyProgress,
  updateContentItemProgress,
  buildProgressSummary,
  saveCourseSummary,
  extractDurationSeconds,
};
