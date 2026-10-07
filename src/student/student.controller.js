const mongoose = require('mongoose');
const Exam = require('../../models/Exam');
const TestResult = require('../common/models/testResult.model');
const Student = require('../../models/Student');
const User = require('../../models/User');
const { verifyStudentCourseAccess, verifyStudentCourseAccessAny } = require('../../utils/courseAccessHelper');
const {
  getStudentCandidateIds,
  getStudentExamAttemptMap,
  computeExamAttemptMetrics
} = require('../../utils/examAttemptHelper');
const { parsePaginationParams, buildPaginationResponse } = require('../../utils/pagination');
const { sanitizeQuestionForStudent, resolveNegativeMark, evaluateSubmittedAnswers } = require('./normalExamRules');
const {
  expandLegacyCourseFiltersForExamArrays,
  getExamAssignedCourseIds,
  buildStudentPublishedExamClause,
} = require('../../utils/examCourseAssignment');
try { require('../../models/Course'); } catch (e) {}

/**
 * Helper to resolve courseName and moduleName for an exam object (populated or plain).
 */
async function resolveCourseAndModuleNames(exam) {
  if (!exam) return { courseName: null, moduleName: null, canonicalCourseId: null };
  let courseName = exam.courseName || null;
  let moduleName = exam.moduleName || null;
  let canonicalCourseId = null;

  if (exam.courseId) {
    if (typeof exam.courseId === 'object') {
      canonicalCourseId = exam.courseId._id ? exam.courseId._id.toString() : null;
      if (!courseName) {
        courseName = exam.courseId.courseTitle || exam.courseId.title || null;
      }
      if (!moduleName && exam.moduleId && Array.isArray(exam.courseId.modules)) {
        const modObj = exam.courseId.modules.find(
          (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
        );
        if (modObj) {
          moduleName = modObj.moduleName || null;
        }
      }
    } else if (typeof exam.courseId === 'string') {
      try {
        const isObjId = mongoose.Types.ObjectId.isValid(exam.courseId);
        const CourseModel = mongoose.models.Course || require('../../models/Course');
        const foundCourse = await CourseModel.findOne({
          $or: [
            ...(isObjId ? [{ _id: exam.courseId }] : []),
            { courseId: exam.courseId },
            { courseTitle: exam.courseId },
            { title: exam.courseId }
          ]
        }).lean();

        if (foundCourse) {
          canonicalCourseId = foundCourse._id.toString();
          if (!courseName) courseName = foundCourse.courseTitle || foundCourse.title || null;
          if (!moduleName && exam.moduleId && Array.isArray(foundCourse.modules)) {
            const modObj = foundCourse.modules.find(
              (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
            );
            if (modObj) {
              moduleName = modObj.moduleName || null;
            }
          }
        }
      } catch (err) {
        // Optional lookup error handled gracefully
      }
    }
  }

  return { courseName, moduleName, canonicalCourseId };
}

/**
 * Batch-resolve courseName and moduleName for a list of exams in ONE query.
 * Eliminates the N+1 per-exam resolveCourseAndModuleNames pattern.
 * @param {Array} exams - lean exam documents
 * @returns {Map<string, Object>} courseMap keyed by courseId string
 */
async function batchResolveCourseNames(exams) {
  const courseIdsToFetch = new Set();
  for (const exam of exams) {
    if (exam.courseId && typeof exam.courseId === 'string') {
      const raw = exam.courseId.trim();
      if (raw && raw !== 'null' && raw !== 'undefined') courseIdsToFetch.add(raw);
    }
  }

  const courseMap = new Map();
  if (courseIdsToFetch.size === 0) return courseMap;

  try {
    const CourseModel = mongoose.models.Course || require('../../models/Course');
    const ids = [...courseIdsToFetch];
    const objIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
    const foundCourses = await CourseModel.find({
      $or: [
        ...(objIds.length > 0 ? [{ _id: { $in: objIds } }] : []),
        { courseId: { $in: ids } },
        { courseTitle: { $in: ids } },
        { title: { $in: ids } }
      ]
    }).select('courseId courseTitle title name modules').lean();

    for (const fc of foundCourses) {
      if (fc._id) courseMap.set(fc._id.toString(), fc);
      if (fc.courseId) courseMap.set(fc.courseId, fc);
      if (fc.courseTitle) courseMap.set(fc.courseTitle, fc);
      if (fc.title) courseMap.set(fc.title, fc);
    }
  } catch (err) {
    // Batch course lookup failed gracefully
  }

  return courseMap;
}

function getQuestionCorrectOption(question) {
  if (!question) return null;
  const rawCorrectAnswer = question.correctOption ?? question.correctAnswer ?? null;
  if (rawCorrectAnswer === null || rawCorrectAnswer === undefined || rawCorrectAnswer === '') return null;
  return normalizeOptionKey(rawCorrectAnswer, question.options) || rawCorrectAnswer.toString().toUpperCase();
}

function formatQuestionWithAnswerKey(question) {
  const correctOption = getQuestionCorrectOption(question);
  const correctOptionText = question && question.options && correctOption
    ? (question.options[correctOption] || null)
    : null;

  return {
    ...question,
    correctOption,
    correctAnswer: correctOption,
    correctOptionText,
    correctAnswerText: correctOptionText
  };
}

/**
 * GET /api/student/profile (or /api/student/me)
 * Fetch authenticated student's profile details.
 */
async function getStudentProfile(req, res) {
  try {
    const studentId = req.user && (req.user.id || req.user.userId);
    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    const email = req.user.email;
    const isObjectId = mongoose.Types.ObjectId.isValid(studentId);

    // 1. Look up Student record first
    let studentDoc = null;
    if (isObjectId) {
      studentDoc = await Student.findOne({
        $or: [
          { _id: new mongoose.Types.ObjectId(studentId) },
          { userId: new mongoose.Types.ObjectId(studentId) },
          ...(email ? [{ email: email.toLowerCase().trim() }] : [])
        ]
      }).lean();
    } else if (email) {
      studentDoc = await Student.findOne({ email: email.toLowerCase().trim() }).lean();
    }

    // 2. Look up User record to ensure all fresh user fields are present
    let userDoc = null;
    if (isObjectId) {
      userDoc = await User.findById(studentId).select('-password').lean();
    }
    if (!userDoc && email) {
      userDoc = await User.findOne({ email: email.toLowerCase().trim() }).select('-password').lean();
    }

    if (!studentDoc && !userDoc) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found.'
      });
    }

    // Determine canonical ID
    const profileId = (studentDoc && studentDoc._id ? studentDoc._id.toString() : null) ||
                      (userDoc && userDoc._id ? userDoc._id.toString() : studentId);

    const name = (studentDoc && studentDoc.name) || (userDoc && userDoc.name) || (req.user && req.user.name) || '';
    const studentEmail = (studentDoc && studentDoc.email) || (userDoc && userDoc.email) || (req.user && req.user.email) || '';
    const contactNumber = (studentDoc && (studentDoc.contactNumber || studentDoc.phone)) ||
                          (userDoc && (userDoc.contactNumber || userDoc.phone)) || '';
    const dateOfBirth = (studentDoc && studentDoc.dateOfBirth) || (userDoc && userDoc.dateOfBirth) || '';
    const qualification = (studentDoc && studentDoc.qualification) || (userDoc && userDoc.qualification) || '';
    const course = (studentDoc && studentDoc.course) || 'General';
    const subscription = (studentDoc && studentDoc.subscription) || 'Free';
    const status = (studentDoc && studentDoc.status) || 'Active';
    const profileImage = (studentDoc && (studentDoc.profileImage || studentDoc.avatar)) || '';

    const courseRef = (studentDoc && studentDoc.courseRef) || (userDoc && userDoc.courseRef) || req.user?.courseRef || null;
    const courseId = (studentDoc && studentDoc.courseId) || (userDoc && userDoc.courseId) || req.user?.courseId || (courseRef ? courseRef.toString() : '');

    // ── Multi-course: collect all enrolled course IDs ────────────────────────
    const seenIds = new Set();
    const registeredCourseIds = [];
    const addRCId = (id) => {
      const s = String(id || '').trim();
      if (!s || seenIds.has(s)) return;
      seenIds.add(s);
      registeredCourseIds.push(s);
    };
    if (studentDoc) {
      if (Array.isArray(studentDoc.courseIds)) studentDoc.courseIds.forEach(addRCId);
      if (studentDoc.courseId) addRCId(studentDoc.courseId);
      if (studentDoc.courseRef) addRCId(String(studentDoc.courseRef));
    }
    if (userDoc) {
      if (Array.isArray(userDoc.courseIds)) userDoc.courseIds.forEach(addRCId);
      if (userDoc.courseId) addRCId(userDoc.courseId);
    }
    if (Array.isArray(req.user?.courseIds)) req.user.courseIds.forEach(addRCId);
    if (courseId) addRCId(courseId);

    const resolvedSubscriptionStatus = (studentDoc && (studentDoc.subscriptionStatus || studentDoc.subscription)) ||
                                       (userDoc && (userDoc.subscriptionStatus || userDoc.subscription)) ||
                                       subscription || 'Active';

    const profileData = {
      _id: profileId,
      id: profileId,
      name,
      email: studentEmail,
      phone: contactNumber,
      contactNumber,
      // Legacy single-course fields (backward compatibility)
      registeredCourseId: courseId,
      courseId,
      courseRef: courseRef ? courseRef.toString() : null,
      // Multi-course fields
      courseIds: registeredCourseIds,
      registeredCourseIds: registeredCourseIds,
      course,
      subscription,
      subscriptionStatus: resolvedSubscriptionStatus,
      status,
      dateOfBirth,
      qualification,
      profileImage
    };

    return res.status(200).json({
      success: true,
      message: 'Student profile fetched successfully',
      ...profileData,
      data: profileData,
      profile: profileData,
      user: profileData
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch student profile.',
      error: error.message
    });
  }
}

function normalizeTestType(input) {
  if (!input || typeof input !== 'string') return 'grand_mock';
  const clean = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (clean === 'course_test' || clean === 'course' || clean.includes('course')) {
    return 'course_test';
  }
  if (clean === 'grand_mock' || clean === 'mock' || clean.includes('grand') || clean.includes('mock')) {
    return 'grand_mock';
  }
  return 'grand_mock';
}

function isPublishedForStudents(exam) {
  const status = exam?.status === undefined || exam?.status === null || String(exam.status).trim() === ''
    ? 'Published'
    : String(exam.status).trim().toLowerCase();
  return status === 'published';
}

async function verifyStudentExamEligibility(req, res) {
  const role = (req.user?.role || '').toLowerCase().trim();
  if (role !== 'student') return true;

  const candidateIds = await getStudentCandidateIds(req.user);
  let student = null;
  if (req.user?.studentId && mongoose.Types.ObjectId.isValid(req.user.studentId)) {
    student = await Student.findById(req.user.studentId).lean();
  }
  if (!student && candidateIds.length) {
    student = await Student.findOne({ $or: [
      { _id: { $in: candidateIds } },
      { userId: { $in: candidateIds } },
    ] }).lean();
  }
  if (!student && req.user?.email) {
    student = await Student.findOne({ email: req.user.email.toLowerCase().trim() }).lean();
  }
  if (!student) {
    res.status(403).json({ success: false, message: 'Student profile not found.' });
    return false;
  }
  const activeStatuses = ['approved', 'active'];
  const accountStatus = String(student.accountStatus || '').trim().toLowerCase();
  const studentStatus = String(student.status || '').trim().toLowerCase();
  if (!(activeStatuses.includes(accountStatus) || activeStatuses.includes(studentStatus) || student.isApproved === true)) {
    res.status(403).json({ success: false, message: 'Account is not active or approved.' });
    return false;
  }
  return true;
}

function applyPublishedExamFilter(filter) {
  filter.$and = [...(filter.$and || []), buildStudentPublishedExamClause()];
}

/**
 * GET /api/student/exams
 * Fetch all available exams for student, annotating each with attempt status and previous score.
 */
async function getAvailableExams(req, res) {
  try {
    const isStaff = ['admin', 'superadmin'].includes((req.user?.role || '').toLowerCase());
    const studentId = req.user && (req.user.studentId || req.user.id);
    if (!studentId && !isStaff) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

        // Fetch student to get courseId
    const isObjectId = mongoose.Types.ObjectId.isValid(studentId);
    let studentDoc = null;
    if (isObjectId) {
      studentDoc = await Student.findOne({
        $or: [
          { _id: new mongoose.Types.ObjectId(studentId) },
          { userId: new mongoose.Types.ObjectId(studentId) }
        ]
      });
    }
    if (!studentDoc) {
      studentDoc = await User.findById(studentId);
    }

    if (!studentDoc && !isStaff) {
      return res.status(404).json({ success: false, message: 'Student profile not found.' });
    }

    const filter = {};
    const reqQuery = req ? (req.query || {}) : {};
    const queryType = reqQuery.testType || reqQuery.type;

    const isExplicitGrandMock = queryType && normalizeTestType(queryType) === 'grand_mock';
    const isExplicitCourseTest = queryType && normalizeTestType(queryType) === 'course_test';

    const targetCourseId = reqQuery.courseId ? String(reqQuery.courseId).trim() : null;

    if (isExplicitGrandMock) {
      filter.testType = { $ne: 'course_test' };
      filter.$or = [
        { testType: 'grand_mock' },
        { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
        { testType: { $exists: false } },
        { testType: null },
        { testType: '' }
      ];
    } else if (isExplicitCourseTest) {
      filter.testType = 'course_test';
    }

    if (targetCourseId && !isExplicitGrandMock) {
      if (!isStaff && studentDoc) {
        const hasAccess = await verifyStudentCourseAccess(req.user, targetCourseId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'You are not authorized to access exams for this course.'
          });
        }
      }

      filter.testType = 'course_test';
      const CourseModel = mongoose.models.Course || require('../../models/Course');
      let targetCourseDoc = null;
      if (mongoose.Types.ObjectId.isValid(targetCourseId)) {
        targetCourseDoc = await CourseModel.findById(targetCourseId).lean();
      }
      if (!targetCourseDoc) {
        targetCourseDoc = await CourseModel.findOne({ courseId: targetCourseId }).lean();
      }

      const specificCourseOr = [{ courseId: targetCourseId }];
      if (mongoose.Types.ObjectId.isValid(targetCourseId)) {
        specificCourseOr.push({ courseId: new mongoose.Types.ObjectId(targetCourseId) });
      }
      if (targetCourseDoc) {
        if (targetCourseDoc._id) {
          specificCourseOr.push({ courseId: targetCourseDoc._id });
          specificCourseOr.push({ courseId: targetCourseDoc._id.toString() });
        }
        if (targetCourseDoc.courseId) {
          specificCourseOr.push({ courseId: targetCourseDoc.courseId });
        }
      }
      filter.$or = expandLegacyCourseFiltersForExamArrays(specificCourseOr);
    } else {
      if (!isStaff && studentDoc && !isExplicitGrandMock) {
        // ── Multi-course: collect all enrolled course IDs ──────────────────────
        const { getStudentEnrolledCourseIds } = require('../../utils/courseAccessHelper');
        const { rawIds, objectIds } = getStudentEnrolledCourseIds(studentDoc);

        // Also pull from req.user (JWT claims) for redundancy
        const jwtCourses = getStudentEnrolledCourseIds(req.user).rawIds;
        jwtCourses.forEach((id) => { if (!rawIds.includes(id)) rawIds.push(id); });

        // Batch-resolve all enrolled courses from DB to get every identifier form
        const CourseModel = mongoose.models.Course || require('../../models/Course');
        const courseOrConditions = [];
        if (objectIds.length > 0) {
          courseOrConditions.push({ _id: { $in: objectIds } });
        }
        if (rawIds.length > 0) {
          courseOrConditions.push({ courseId: { $in: rawIds } });
          const moreObjIds = rawIds
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));
          if (moreObjIds.length > 0) {
            courseOrConditions.push({ _id: { $in: moreObjIds } });
          }
        }
        // Also add course title
        const studentCourseTitle = studentDoc.course || studentDoc.preferredCourse || req.user?.course;
        if (studentCourseTitle) {
          courseOrConditions.push({ courseTitle: studentCourseTitle });
          courseOrConditions.push({ title: studentCourseTitle });
        }

        const courseOrFilter = [];

        if (courseOrConditions.length > 0) {
          const enrolledCourseDocs = await CourseModel.find({ $or: courseOrConditions })
            .select('_id courseId courseTitle')
            .lean();

          for (const cd of enrolledCourseDocs) {
            if (cd._id) {
              courseOrFilter.push({ courseId: cd._id });
              courseOrFilter.push({ courseId: cd._id.toString() });
            }
            if (cd.courseId) courseOrFilter.push({ courseId: cd.courseId });
            if (cd.courseTitle) courseOrFilter.push({ courseName: cd.courseTitle });
          }
        }

        // Add raw string IDs directly (for exams that store courseId as custom string)
        for (const rawId of rawIds) {
          courseOrFilter.push({ courseId: rawId });
        }
        if (studentCourseTitle) {
          courseOrFilter.push({ courseName: studentCourseTitle });
        }

        if (courseOrFilter.length > 0) {
          // Deduplicate
          const seen = new Set();
          const uniqueFilter = courseOrFilter.filter(f => {
            const k = JSON.stringify(f);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });

          const expandedCourseFilters = expandLegacyCourseFiltersForExamArrays(uniqueFilter);
          if (isExplicitCourseTest) {
            filter.$or = expandedCourseFilters;
          } else {
            // Allow enrolled course exams OR grand mocks
            filter.$or = [
              ...expandedCourseFilters.map(c => ({ ...c, testType: 'course_test' })),
              { testType: 'grand_mock' },
              { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
              { testType: { $exists: false } },
              { testType: null },
              { testType: '' }
            ];
          }
        } else {
          if (isExplicitCourseTest) {
            return res.status(200).json({ success: true, count: 0, data: [] });
          } else {
            filter.testType = { $ne: 'course_test' };
          }
        }
      }
    }

    // Student discovery is server-side restricted to Published exams. Legacy
    // documents without status retain the former published behavior.
    applyPublishedExamFilter(filter);

    // ── Pagination ──
    let page, limit, skip;
    try {
      ({ page, limit, skip } = parsePaginationParams(reqQuery, { defaultLimit: 20 }));
    } catch (pErr) {
      return res.status(pErr.statusCode || 400).json({ success: false, message: pErr.message });
    }

    // 1. Run count + paginated find concurrently
    const [total, exams] = await Promise.all([
      Exam.countDocuments(filter),
      Exam.find(filter)
        .select('-questions')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // 2. Resolve candidate IDs + attempt map + batch course names concurrently
    const candidateIds = await getStudentCandidateIds(req.user);
    const [attemptMap, courseMap] = await Promise.all([
      getStudentExamAttemptMap(candidateIds, exams.map((e) => e._id)),
      batchResolveCourseNames(exams)
    ]);

    // 3. Combine exams with authoritative student attempt status (NO per-exam DB calls)
    const formattedExams = exams.map((exam) => {
      let courseName = exam.courseName || null;
      let moduleName = exam.moduleName || null;
      let canonicalCourseId = null;

      if (exam.courseId && typeof exam.courseId === 'string') {
        const foundCourse = courseMap.get(exam.courseId.trim());
        if (foundCourse) {
          canonicalCourseId = foundCourse._id ? foundCourse._id.toString() : null;
          if (!courseName) courseName = foundCourse.courseTitle || foundCourse.title || null;
          if (!moduleName && exam.moduleId && Array.isArray(foundCourse.modules)) {
            const modObj = foundCourse.modules.find(
              (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
            );
            if (modObj) moduleName = modObj.moduleName || null;
          }
        }
      }

      const examIdStr = exam._id.toString();
      const resultsForExam = attemptMap.get(examIdStr) || [];
      const metrics = computeExamAttemptMetrics(exam, resultsForExam);

      return {
        ...exam,
        courseId: canonicalCourseId || exam.courseId,
        courseName,
        moduleName,
        negativeMark: exam.negativeMark !== undefined && exam.negativeMark !== null
          ? exam.negativeMark
          : (exam.negativeMarkPenalty ?? 0),
        status: exam.status || 'Published',
        attemptStatus: metrics.attemptStatus,
        hasAttempted: metrics.hasAttempted,
        isCompleted: metrics.isCompleted,
        previousScore: metrics.previousScore,
        score: metrics.score,
        totalMarks: metrics.totalMarks,
        lastAttemptedAt: metrics.lastAttemptedAt,
        submittedAt: metrics.submittedAt,
        resultId: metrics.resultId
      };
    });

    const pagination = buildPaginationResponse(total, page, limit);

    return res.status(200).json({
      success: true,
      count: formattedExams.length,
      data: formattedExams,
      pagination
    });
  } catch (error) {
    console.error('Error fetching student available exams:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch available exams.',
      error: error.message
    });
  }
}

/**
 * GET /api/student/exams/:id/start
 * Fetch exam details for starting a test.
 * CRITICAL ANTI-CHEAT: Strips the `correctOption` field from all questions before sending to client.
 * Also records an "In Progress" attempt state if no completed attempt exists yet.
 */
async function startExam(req, res) {
  try {
    const { id } = req.params;

    if (!(await verifyStudentExamEligibility(req, res))) return;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    const exam = await Exam.findById(id).lean();

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Grand Mock Exam not found.'
      });
    }

    if (!isPublishedForStudents(exam)) {
      return res.status(404).json({ success: false, message: 'Grand Mock Exam not found.' });
    }

    if (normalizeTestType(exam.testType) === 'course_test') {
      const assignedCourseIds = getExamAssignedCourseIds(exam);
      if (assignedCourseIds.length === 0) {
        return res.status(404).json({ success: false, message: 'Course Test not found.' });
      }
      const hasAccess = await verifyStudentCourseAccessAny(req.user, assignedCourseIds);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this exam.'
        });
      }
    }

    // Record 'In Progress' attempt if student has not completed it yet
    if (req.user) {
      try {
        const candidateIds = await getStudentCandidateIds(req.user);
        if (candidateIds.length > 0) {
          const existingCompleted = await TestResult.findOne({
            studentId: { $in: candidateIds },
            examId: exam._id,
            status: { $in: ['Completed', 'Attempted'] }
          }).lean();

          if (!existingCompleted) {
            const existingInProgress = await TestResult.findOne({
              studentId: { $in: candidateIds },
              examId: exam._id,
              status: 'In Progress'
            }).lean();

            if (!existingInProgress) {
              const primaryStudentId = (req.user.id && mongoose.Types.ObjectId.isValid(req.user.id))
                ? new mongoose.Types.ObjectId(req.user.id)
                : candidateIds[0];

              const totalQ = exam.totalQuestions || (Array.isArray(exam.questions) ? exam.questions.length : 0);
              const marksPerQ = exam.marksPerQuestion || 1;

              await TestResult.create({
                studentId: primaryStudentId,
                examId: exam._id,
                score: 0,
                totalMarks: totalQ * marksPerQ,
                totalAttempted: 0,
                totalCorrect: 0,
                totalWrong: 0,
                unansweredQuestions: totalQ,
                positiveMarks: 0,
                negativeMarks: 0,
                maximumScore: totalQ * marksPerQ,
                percentage: 0,
                status: 'In Progress',
                answers: []
              });
            }
          }
        }
      } catch (trackErr) {
        console.warn('Failed to record In Progress state during startExam:', trackErr.message);
      }
    }

    const { courseName, moduleName, canonicalCourseId } = await resolveCourseAndModuleNames(exam);

    // Sanitize questions to prevent cheating - completely remove `correctOption`
    const sanitizedQuestions = (exam.questions || []).map(sanitizeQuestionForStudent);

    return res.status(200).json({
      success: true,
      data: {
        ...exam,
        courseId: canonicalCourseId || exam.courseId,
        courseName,
        moduleName,
        negativeMark: resolveNegativeMark(exam),
        questions: sanitizedQuestions
      }
    });
  } catch (error) {
    console.error('Error starting exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start exam.',
      error: error.message
    });
  }
}

/**
 * Helper function to normalize any option representation (letter, option string, index, or option text)
 * into a canonical option key: 'A', 'B', 'C', or 'D'.
 * Returns null if unattempted, empty, or invalid.
 */
function normalizeOptionKey(rawOption, questionOptions) {
  if (rawOption === null || rawOption === undefined) {
    return null;
  }

  // Convert to string and trim whitespace
  let str = String(rawOption).trim();
  if (str === '' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return null;
  }

  const uppercaseStr = str.toUpperCase();

  // 1. Direct single letter check ('A', 'B', 'C', 'D')
  if (['A', 'B', 'C', 'D'].includes(uppercaseStr)) {
    return uppercaseStr;
  }

  // 2. Prefix pattern match (e.g., "Option A", "Option_A", "OPT A", "Opt. A", "A)", "A.", "A - ...", "Answer: A")
  const prefixMatch = uppercaseStr.match(/^(?:OPTION|OPT|ANSWER)?[\s._:-]*([A-D])(?:\)|\.|\s|-|$)/i);
  if (prefixMatch && ['A', 'B', 'C', 'D'].includes(prefixMatch[1].toUpperCase())) {
    return prefixMatch[1].toUpperCase();
  }

  // 3. Numeric index matching (0 -> A, 1 -> B, 2 -> C, 3 -> D)
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num === 0) return 'A';
    if (num === 1) return 'B';
    if (num === 2) return 'C';
    if (num === 3) return 'D';
  }

  // 4. Option text matching against questionOptions { A, B, C, D }
  if (questionOptions && typeof questionOptions === 'object') {
    const cleanInput = str.toLowerCase();

    for (const key of ['A', 'B', 'C', 'D']) {
      const optionText = questionOptions[key];
      if (optionText && typeof optionText === 'string') {
        const cleanOptionText = optionText.trim().toLowerCase();

        // Exact option text match
        if (cleanInput === cleanOptionText) {
          return key;
        }

        // Match if input stripped of prefix ("A) ", "A. ") matches option text
        const strippedInput = cleanInput.replace(/^(?:option|opt)?[\s._:-]*[a-d][\).\s_-]*/i, '').trim();
        if (strippedInput && strippedInput === cleanOptionText) {
          return key;
        }

        // Match if option text stripped of prefix matches input
        const strippedOptionText = cleanOptionText.replace(/^(?:option|opt)?[\s._:-]*[a-d][\).\s_-]*/i, '').trim();
        if (strippedOptionText && (cleanInput === strippedOptionText || strippedInput === strippedOptionText)) {
          return key;
        }
      }
    }
  }

  return null;
}

/**
 * POST /api/student/exams/:id/submit
 * Submits student's answers, evaluates against the database with robust answer verification and negative marking calculation,
 * computes final score, and saves TestResult.
 * Payload: { answers: [{ questionId: "...", selectedOption: "A" }] }
 */
async function submitExam(req, res) {
  try {
    const { id } = req.params;
    const studentId = req.user && req.user.id;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    if (!(await verifyStudentExamEligibility(req, res))) return;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Exam ID format.'
      });
    }

    // 1. Fetch original exam with answer keys from database
    // Lean keeps absent legacy negativeMark fields absent so penalty fallback
    // to negativeMarkPenalty can distinguish them from an intentional zero.
    const exam = await Exam.findById(id).lean();
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found.'
      });
    }

    if (!isPublishedForStudents(exam)) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    if (normalizeTestType(exam.testType) === 'course_test') {
      const assignedCourseIds = getExamAssignedCourseIds(exam);
      if (assignedCourseIds.length === 0) {
        return res.status(404).json({ success: false, message: 'Course Test not found.' });
      }
      const hasAccess = await verifyStudentCourseAccessAny(req.user, assignedCourseIds);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this exam.'
        });
      }
    }

    const candidateIds = await getStudentCandidateIds(req.user);
    if (candidateIds.length === 0) {
      return res.status(401).json({ success: false, message: 'Student identity could not be resolved.' });
    }

    const previousAttempts = await TestResult.find({
      studentId: { $in: candidateIds },
      examId: exam._id,
    }).sort({ createdAt: -1 });
    if (previousAttempts.some((result) => ['Completed', 'Attempted'].includes(result.status))) {
      return res.status(409).json({ success: false, message: 'This exam has already been submitted.' });
    }
    const existingInProgress = previousAttempts.find((result) => result.status === 'In Progress');
    if (!existingInProgress) {
      return res.status(409).json({ success: false, message: 'Start this exam before submitting answers.' });
    }

    // Use exactly the stored exam rules. Unanswered entries remain zero marks.
    const MARKS_CORRECT = Number(exam.marksPerQuestion) || 1;
    const MARKS_PENALTY = resolveNegativeMark(exam);
    let scoring;
    try {
      scoring = evaluateSubmittedAnswers(
        exam.questions || [],
        req.body?.answers,
        MARKS_CORRECT,
        MARKS_PENALTY,
        normalizeOptionKey
      );
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        success: false,
        message: validationError.message,
      });
    }
    const {
      answers: processedAnswers,
      totalQuestions,
      totalAttempted,
      totalCorrect,
      totalWrong,
      unansweredQuestions,
      positiveMarks,
      negativeMarks,
      maximumScore,
      totalMarks,
      score: finalScore,
      percentage,
    } = scoring;

    // Update the already-created in-progress attempt; never create a second
    // completed attempt from the submission endpoint.
    const primaryStudentId = (req.user.id && mongoose.Types.ObjectId.isValid(req.user.id))
      ? new mongoose.Types.ObjectId(req.user.id)
      : candidateIds[0];
    const testResult = await TestResult.findOneAndUpdate(
      { _id: existingInProgress._id, status: 'In Progress' },
      { $set: {
        studentId: existingInProgress.studentId || primaryStudentId,
        score: finalScore,
        totalMarks,
        totalAttempted,
        totalCorrect,
        totalWrong,
        unansweredQuestions,
        positiveMarks,
        negativeMarks,
        maximumScore,
        percentage,
        status: 'Completed',
        answers: processedAnswers,
      } },
      { new: true, runValidators: true }
    );
    if (!testResult) {
      return res.status(409).json({ success: false, message: 'This exam has already been submitted.' });
    }

    return res.status(201).json({
      success: true,
      message: 'Exam submitted and evaluated successfully.',
      data: {
        _id:                  testResult._id,
        studentId:            testResult.studentId,
        examId:               testResult.examId,
        // ── Exam Rules Applied ─────────────────────────────────────
        marksPerQuestion:     MARKS_CORRECT,
        negativeMark:         MARKS_PENALTY,
        negativeMarkPenalty:  MARKS_PENALTY,
        // ── Scoring Breakdown ──────────────────────────────────────
        totalQuestions:       totalQuestions,
        attemptedQuestions:   totalAttempted,
        correctAnswers:       totalCorrect,
        wrongAnswers:         totalWrong,
        unansweredQuestions:  unansweredQuestions,
        // ── Marks ─────────────────────────────────────────────────
        positiveMarks:        Math.round(positiveMarks * 100) / 100,
        negativeMarks:        Math.round(negativeMarks * 100) / 100,
        finalScore:           finalScore,
        maximumScore:         maximumScore,
        percentage:           percentage,
        // ── Legacy Fields (preserved for backwards compatibility) ──
        score:                finalScore,
        totalMarks:           totalMarks,
        totalAttempted:       totalAttempted,
        totalCorrect:         totalCorrect,
        totalWrong:           totalWrong,
        // ──────────────────────────────────────────────────────────
        status:               testResult.status,
        attemptStatus:        'completed',
        hasAttempted:         true,
        isCompleted:          true,
        answers:              processedAnswers,
        examInfo: {
          ...exam,
          questions: exam.questions.map(formatQuestionWithAnswerKey)
        },
        createdAt:            testResult.createdAt
      }
    });
  } catch (error) {
    console.error('Error submitting exam:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit exam.',
      error: error.message
    });
  }
}

/**
 * GET /api/student/results
 * Fetches all past test results for the authenticated student.
 */
async function getStudentResults(req, res) {
  try {
    const candidateIds = await getStudentCandidateIds(req.user);
    const role = (req.user?.role || '').toLowerCase().trim();
    const maskedStudentId = req.user?.studentId || req.user?.id || req.user?.userId ? '<present>' : '<none>';
    const isApproved = req.user?.isApproved !== undefined ? req.user.isApproved : true;

    if (!candidateIds || candidateIds.length === 0) {
      console.warn('[STUDENT RESULTS DEBUG]', {
        route: req.originalUrl || req.url,
        authenticated: !!req.user,
        role: role,
        studentId: maskedStudentId,
        approved: isApproved,
        resultCount: 0,
        '403Reason': 'Unauthorized: candidate student IDs could not be resolved',
      });
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found in session/token.'
      });
    }

    const reqQuery = req ? (req.query || {}) : {};
    const filterType = reqQuery.testType || reqQuery.type;
    let matchingExamIds = null;
    if (filterType && filterType.trim()) {
      const targetType = normalizeTestType(filterType);
      const query = targetType === 'grand_mock'
        ? {
            testType: { $ne: 'course_test' },
            $or: [
              { testType: 'grand_mock' },
              { testType: { $regex: /^(grand[-_ ]?mock|mock)$/i } },
              { testType: { $exists: false } },
              { testType: null },
              { testType: '' }
            ]
          }
        : { testType: 'course_test' };
      const matchingExams = await Exam.find(query).select('_id').lean();
      matchingExamIds = matchingExams.map(e => e._id.toString());
    }

    // ── Pagination ──
    let page, limit, skip;
    try {
      ({ page, limit, skip } = parsePaginationParams(reqQuery, { defaultLimit: 20 }));
    } catch (pErr) {
      return res.status(pErr.statusCode || 400).json({ success: false, message: pErr.message });
    }

    const resultFilter = { studentId: { $in: candidateIds } };
    if (matchingExamIds !== null) {
      resultFilter.examId = { $in: matchingExamIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    // Run count + paginated find concurrently
    const [totalResults, results] = await Promise.all([
      TestResult.countDocuments(resultFilter),
      TestResult.find(resultFilter)
        .populate('examId', 'title testType courseId moduleId courseName moduleName marksPerQuestion negativeMark negativeMarkPenalty durationMinutes totalQuestions questions')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // Batch resolve course access and course names (replaces two N+1 loops)
    const courseAccessResults = await Promise.all(
      results.map(async (r) => {
        if (!r.examId) return false;
        const exam = r.examId;
        if (exam.courseId && normalizeTestType(exam.testType) === 'course_test') {
          return verifyStudentCourseAccess(req.user, exam.courseId);
        }
        return true; // Grand mock results are global
      })
    );
    const validResults = results.filter((_, i) => courseAccessResults[i]);

    // Batch resolve course names for all exam metadata
    const examsForBatch = validResults.map(r => r.examId).filter(Boolean);
    const courseMap = await batchResolveCourseNames(examsForBatch);

    const formattedResults = validResults.map((result) => {
      const exam = result.examId;
      const questionMap = new Map();
      if (exam && Array.isArray(exam.questions)) {
        exam.questions.forEach((q, index) => {
          if (q._id) {
            questionMap.set(q._id.toString(), q);
          }
          questionMap.set(index.toString(), q);
          questionMap.set((index + 1).toString(), q);
        });
      }

      const storedAnswers = result.answers || [];
      const formattedAnswers = exam && Array.isArray(exam.questions)
        ? exam.questions.map((question, index) => {
          const ans = storedAnswers.find((item) => item.questionId && question._id && item.questionId.toString() === question._id.toString()) || storedAnswers[index] || {};
          const correctOpt = ans.correctOption || ans.correctAnswer || getQuestionCorrectOption(question);
          const selectedOption = ans.selectedOption !== undefined ? ans.selectedOption : null;
          return {
            questionId: question._id || ans.questionId || null,
            questionText: ans.questionText || question.questionText || '',
            options: ans.options || question.options || {},
            selectedOption,
            selectedAnswer: ans.selectedAnswer !== undefined ? ans.selectedAnswer : selectedOption,
            selectedOptionText: ans.selectedOptionText || (selectedOption ? (ans.options || question.options)?.[selectedOption] : null) || null,
            correctOption: correctOpt || null,
            correctAnswer: ans.correctAnswer || correctOpt || null,
            correctOptionText: ans.correctOptionText || (correctOpt ? (ans.options || question.options)?.[correctOpt] : null) || null,
            isCorrect: ans.isCorrect ?? (selectedOption !== null && selectedOption === correctOpt),
            status: ans.status || (selectedOption == null ? 'unanswered' : (selectedOption === correctOpt ? 'correct' : 'wrong'))
          };
        })
        : storedAnswers.map((ans) => {
        let correctOpt = ans.correctOption || ans.correctAnswer || null;
        let targetQ = null;
        if (ans.questionId) {
          targetQ = questionMap.get(ans.questionId.toString());
          if (!correctOpt && targetQ) {
            correctOpt = getQuestionCorrectOption(targetQ);
          }
        }
        return {
          questionId: ans.questionId,
          questionText: ans.questionText || targetQ?.questionText || '',
          options: ans.options || targetQ?.options || {},
          selectedOption: ans.selectedOption !== undefined ? ans.selectedOption : null,
          selectedAnswer: ans.selectedAnswer !== undefined ? ans.selectedAnswer : (ans.selectedOption !== undefined ? ans.selectedOption : null),
          selectedOptionText: ans.selectedOptionText || (ans.options && ans.selectedOption ? ans.options[ans.selectedOption] : null) || (targetQ && targetQ.options && ans.selectedOption ? targetQ.options[ans.selectedOption] : null),
          correctOption: correctOpt || null,
          correctAnswer: ans.correctAnswer || correctOpt || null,
          correctOptionText: ans.correctOptionText || (ans.options && correctOpt ? ans.options[correctOpt] : null) || (targetQ && targetQ.options && correctOpt ? (targetQ.options[correctOpt] || null) : null),
          isCorrect: ans.isCorrect,
          status: ans.status || (ans.selectedOption == null ? 'unanswered' : (ans.isCorrect ? 'correct' : 'wrong'))
        };
      });

      let examMetadata = exam;
      if (exam) {
        // Resolve from batch map instead of N+1 query
        let resolvedCourseName = exam.courseName || null;
        let resolvedModuleName = exam.moduleName || null;
        if (exam.courseId && typeof exam.courseId === 'string') {
          const fc = courseMap.get(exam.courseId.trim());
          if (fc) {
            if (!resolvedCourseName) resolvedCourseName = fc.courseTitle || fc.title || null;
            if (!resolvedModuleName && exam.moduleId && Array.isArray(fc.modules)) {
              const modObj = fc.modules.find(
                (m) => m && ((m._id && m._id.toString() === exam.moduleId.toString()) || m.moduleName === exam.moduleId)
              );
              if (modObj) resolvedModuleName = modObj.moduleName || null;
            }
          }
        }
        if (exam.questions) {
          const { questions, ...restExam } = exam;
          examMetadata = {
            ...restExam,
            courseName: resolvedCourseName,
            moduleName: resolvedModuleName
          };
        } else {
          examMetadata = {
            ...exam,
            courseName: resolvedCourseName,
            moduleName: resolvedModuleName
          };
        }
        const formattedQuestions = (exam.questions || []).map(formatQuestionWithAnswerKey);

        examMetadata = {
          ...exam,
          courseName: resolvedCourseName,
          moduleName: resolvedModuleName,
          questions: formattedQuestions
        };
      }

      return {
        ...result,
        examId: examMetadata,
        answers: formattedAnswers
      };
    });

    const pagination = buildPaginationResponse(totalResults, page, limit);

    console.log('[STUDENT RESULTS DEBUG]', {
      route: req.originalUrl || req.url,
      authenticated: true,
      role: role,
      studentId: maskedStudentId,
      approved: isApproved,
      resultCount: formattedResults.length,
      '403Reason': 'none (success)',
    });

    return res.status(200).json({
      success: true,
      count: formattedResults.length,
      data: formattedResults,
      pagination
    });
  } catch (error) {
    console.error('Error fetching student test results:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch test results.',
      error: error.message
    });
  }
}

module.exports = {
  getStudentProfile,
  getAvailableExams,
  startExam,
  submitExam,
  getStudentResults
};
