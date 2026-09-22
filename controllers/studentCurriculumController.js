const Course = require('../models/Course');
const Student = require('../models/Student');
const LessonProgress = require('../models/LessonProgress');
const { verifyStudentCourseAccess } = require('../utils/courseAccessHelper');
const { logActivity } = require('../utils/activityLogger');

const isFiniteNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function getCurriculumItems(course) {
  return (course.modules || []).flatMap((module) =>
    (module.lessons || []).map((lesson) => ({
      moduleId: module._id ? module._id.toString() : String(module.id || ''),
      lessonId: lesson._id ? lesson._id.toString() : String(lesson.id || ''),
      lesson,
    }))
  );
}

function buildProgressSummary(course, progressDocs) {
  const curriculumItems = getCurriculumItems(course);
  const validLessonIds = new Set(curriculumItems.map((item) => item.lessonId));
  const currentProgress = progressDocs.filter((progress) => validLessonIds.has(String(progress.lessonId)));
  const completedItemIds = new Set(
    currentProgress
      .filter((progress) => progress.completed || progress.videoWatched || progress.pdfViewed || progress.pdfDownloaded || progress.completedAt)
      .map((progress) => String(progress.lessonId))
  );
  const completedItems = completedItemIds.size;
  const totalItems = curriculumItems.length;
  const percentage = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);
  const activeTimeSeconds = currentProgress.reduce((total, progress) => total + (Number(progress.activeTimeSeconds) || 0), 0);

  return {
    totalItems,
    completedItems,
    remainingItems: Math.max(totalItems - completedItems, 0),
    percentage,
    status: totalItems > 0 && completedItems === totalItems ? 'Completed' : completedItems > 0 ? 'In Progress' : 'Not Started',
    activeTimeSeconds,
    // UI-friendly values; the canonical persisted value remains seconds.
    studyTimeSeconds: activeTimeSeconds,
    studyTimeHours: Number((activeTimeSeconds / 3600).toFixed(2)),
  };
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

    const formatted = courses.map((c) => {
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
        totalLessons,
        createdAt: formattedCourse.createdAt,
      };
    });

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
    let progressMap = {};
    if (student) {
      const progressDocs = await LessonProgress.find({
        studentId: student._id,
        courseId: course._id,
      });
      progressDocs.forEach((p) => {
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

    return res.status(200).json({
      success: true,
      data: {
        course: formattedCourse,
        progress: progressMap,
      },
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

    // Do not create progress rows for stale or arbitrary identifiers. Metrics
    // must be based on the same curriculum items students can actually see.
    const curriculumItem = getCurriculumItems(course).find(
      (item) => item.moduleId === String(moduleId) && item.lessonId === String(lessonId)
    );
    if (!curriculumItem) {
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

    // Clients should send activeTimeSeconds for timers which pause when the
    // app is backgrounded. Older video clients get a best-effort fallback from
    // a forward position delta; new clients should always send active time.
    const explicitActiveSeconds = [
      req.body.activeTimeSeconds,
      req.body.timeSpentSeconds,
      req.body.elapsedSeconds,
      req.body.watchTimeSeconds,
      req.body.activeTime,
      req.body.timeSpent,
    ].find(isFiniteNonNegativeNumber);
    const explicitActiveHours = [req.body.activeTimeHours, req.body.studyTimeHours].find(isFiniteNonNegativeNumber);
    const activeDeltaSeconds = explicitActiveSeconds !== undefined
      ? explicitActiveSeconds
      : explicitActiveHours !== undefined
        ? explicitActiveHours * 3600
      : (isFiniteNonNegativeNumber(videoProgress)
        ? Math.max(0, currentProgress - (existingProgress?.videoProgress || 0))
        : 0);

    const updateFields = {
      lastAccessedAt: new Date(),
    };

    if (isFiniteNonNegativeNumber(videoProgress)) updateFields.videoProgress = Math.max(currentProgress, existingProgress?.videoProgress || 0);
    if (duration > 0) updateFields.videoDuration = duration;
    if (percent > 0) updateFields.watchedPercent = Math.max(percent, existingProgress?.watchedPercent || 0);
    if (activeDeltaSeconds > 0) updateFields.activeTimeSeconds = (existingProgress?.activeTimeSeconds || 0) + activeDeltaSeconds;

    if (isCompleted) {
      updateFields.completed = true;
      // A PDF view or a manually completed item is not a video watch.
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

    const wasCompleted = Boolean(existingProgress?.completed || existingProgress?.videoWatched || existingProgress?.pdfViewed || existingProgress?.pdfDownloaded || existingProgress?.completedAt);
    const action = isCompleted && !wasCompleted
      ? 'lesson_completed'
      : isPdfViewed
        ? 'pdf_viewed'
        : videoWatched === true
          ? 'video_watched'
          : 'lesson_progressed';
    const studentName = student.name || student.fullName || student.email || 'A student';
    // Logging is intentionally non-fatal, so a transient activity-feed issue
    // cannot discard a valid learning-progress update.
    await logActivity({
      title: action === 'lesson_completed' ? 'Lesson completed' : action === 'pdf_viewed' ? 'PDF viewed' : 'Lesson activity',
      description: `${studentName} ${action === 'lesson_completed' ? 'completed' : action === 'pdf_viewed' ? 'viewed material in' : 'continued'} ${curriculumItem.lesson.lessonTitle || 'a lesson'} in ${course.courseTitle || 'a course'}`,
      type: 'student_learning',
      action,
      actor: studentIdToUse,
      courseId: course._id,
      moduleId: String(moduleId),
      lessonId: String(lessonId),
      metadata: { activeTimeSeconds: activeDeltaSeconds, watchedPercent: progress.watchedPercent || 0 },
    });

    const allProgressDocs = await LessonProgress.find({ studentId: studentIdToUse, courseId: course._id });
    return res.status(200).json({
      success: true,
      message: 'Lesson progress updated',
      data: progress,
      summary: buildProgressSummary(course, allProgressDocs),
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

    const hasAccess = await verifyStudentCourseAccess(req.user, courseId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this specific course',
      });
    }

    const progressDocs = await LessonProgress.find({
      studentId: student._id,
      courseId: course._id,
    });

    const summary = buildProgressSummary(course, progressDocs);
    return res.status(200).json({
      success: true,
      count: progressDocs.length,
      data: progressDocs,
      summary,
      // Top-level aliases retain compatibility with dashboards that do not
      // unwrap `summary`.
      totalItems: summary.totalItems,
      completedItems: summary.completedItems,
      percentage: summary.percentage,
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

module.exports = {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  getMyProgress,
};
