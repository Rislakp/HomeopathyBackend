const Course = require('../models/Course');
const Student = require('../models/Student');
const LessonProgress = require('../models/LessonProgress');

/**
 * Helper to find Student document from req.user
 */
async function resolveStudent(reqUser) {
  if (!reqUser) return null;
  // 1. Try finding by studentId if present in token
  if (reqUser.studentId) {
    const student = await Student.findById(reqUser.studentId);
    if (student) return student;
  }
  // 2. Try finding by userId FK
  if (reqUser.id || reqUser.userId) {
    const userId = reqUser.id || reqUser.userId;
    let student = await Student.findOne({ userId });
    if (student) return student;
    // 3. Try finding directly by _id (if token ID was Student._id)
    student = await Student.findById(userId);
    if (student) return student;
  }
  // 4. Try finding by email
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

          ['videoParts', 'pdfNotes', 'attachments'].forEach((resKey) => {
            if (Array.isArray(les[resKey])) {
              les[resKey] = les[resKey].map((resItem) => ({
                ...resItem,
                url: ensureAbsoluteUrl(resItem.url),
              }));
            }
          });
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

    let courses;
    if (isStaff) {
      courses = await Course.find({ status: 'Published' }).sort({ createdAt: -1 });
    } else if (student) {
      if (student.courseRef) {
        courses = await Course.find({ _id: student.courseRef, status: 'Published' });
      } else {
        courses = await Course.find({ status: 'Published' }).sort({ createdAt: -1 });
      }
    } else {
      courses = await Course.find({ status: 'Published' }).sort({ createdAt: -1 });
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
        totalModules,
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

      // Check specific courseRef assignment if present
      if (student.courseRef && student.courseRef.toString() !== course._id.toString()) {
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
          videoProgress: p.videoProgress,
          videoDuration: p.videoDuration,
          watchedPercent: p.watchedPercent,
          completedAt: p.completedAt,
          pdfDownloaded: p.pdfDownloaded,
          pdfDownloadedAt: p.pdfDownloadedAt,
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
            videoProgress: 0,
            videoDuration: 0,
            watchedPercent: 0,
            completedAt: null,
            pdfDownloaded: false,
            pdfDownloadedAt: null,
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
    const { videoProgress, videoDuration, videoWatched, pdfDownloaded } = req.body;

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

    const studentIdToUse = student ? student._id : req.user.id;

    // Calculate percent
    let percent = 0;
    const duration = typeof videoDuration === 'number' && videoDuration > 0 ? videoDuration : 0;
    const currentProgress = typeof videoProgress === 'number' && videoProgress > 0 ? videoProgress : 0;

    if (duration > 0) {
      percent = Math.min(100, Math.round((currentProgress / duration) * 100));
    } else if (videoWatched === true) {
      percent = 100;
    }

    const isWatched = percent >= 90 || videoWatched === true;

    const updateFields = {
      lastAccessedAt: new Date(),
    };

    if (typeof videoProgress === 'number') updateFields.videoProgress = currentProgress;
    if (duration > 0) updateFields.videoDuration = duration;
    if (percent > 0) updateFields.watchedPercent = percent;

    if (isWatched) {
      updateFields.videoWatched = true;
      updateFields.completedAt = new Date();
    }

    if (pdfDownloaded === true) {
      updateFields.pdfDownloaded = true;
      updateFields.pdfDownloadedAt = new Date();
    }

    const progress = await LessonProgress.findOneAndUpdate(
      { studentId: studentIdToUse, courseId: course._id, lessonId },
      { $set: updateFields, $setOnInsert: { moduleId } },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Lesson progress updated',
      data: progress,
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

    const progressDocs = await LessonProgress.find({
      studentId: student._id,
      courseId: course._id,
    });

    return res.status(200).json({
      success: true,
      count: progressDocs.length,
      data: progressDocs,
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
