const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const Course = require('../models/Course');
const memoryCache = require('../utils/cache');

/**
 * Sync registered student users from User collection into Student collection if missing
 */
async function syncStudentUsers() {
  try {
    const lastSync = memoryCache.get('last_student_sync');
    if (lastSync) return; // Throttled: sync at most once every 5 minutes

    memoryCache.set('last_student_sync', true, 300); // 5 min TTL

    const studentUsers = await User.find({ role: 'student' })
      .select('_id email name phone contactNumber dateOfBirth qualification createdAt')
      .lean();
    if (!studentUsers || studentUsers.length === 0) return;


    const [existingUserIdsRaw, existingEmailsRaw] = await Promise.all([
      Student.distinct('userId'),
      Student.distinct('email'),
    ]);

    const existingUserIds = new Set(existingUserIdsRaw.filter(Boolean).map(id => id.toString()));
    const existingEmails = new Set(existingEmailsRaw.filter(Boolean).map(e => e.toLowerCase().trim()));

    const toCreate = [];
    for (const u of studentUsers) {
      const uId = u._id.toString();
      const uEmail = u.email ? u.email.toLowerCase().trim() : '';
      if (!existingUserIds.has(uId) && !existingEmails.has(uEmail)) {
        toCreate.push({
          userId: u._id,
          name: u.name || '',
          email: u.email || '',
          phone: u.phone || u.contactNumber || '',
          contactNumber: u.contactNumber || u.phone || '',
          dateOfBirth: u.dateOfBirth || '',
          qualification: u.qualification || '',
          course: 'General',
          name: u.name || 'Student',
          email: u.email,
          phone: u.phone || u.contactNumber || '',
          contactNumber: u.contactNumber || u.phone || '',
          dateOfBirth: u.dateOfBirth || '',
          qualification: u.qualification || '',
          profileImage: u.profileImage || u.avatar || '',
          avatar: u.avatar || u.profileImage || '',
          preferredCourse: u.preferredCourse || u.course || 'UNANI',
          course: u.course || u.preferredCourse || 'UNANI',
          courseId: u.courseId || '',
          courseRef: u.courseRef || null,
          subscription: 'Free',
          status: u.status || 'Pending',
          accountStatus: u.accountStatus || 'Pending',
          isApproved: u.isApproved || false,
          isActive: u.isActive || false,
          joinedDate: u.createdAt || new Date()
        });
      }
    }

    if (toCreate.length > 0) {
      await Student.insertMany(toCreate, { ordered: false });
    }
  } catch (err) {
    console.warn('Sync student users notice:', err.message);
  }
}

/**
 * GET /api/v1/admin/students
 * Fetches a paginated, filterable list of all registered students with profile details,
 * subscription info, and attended exam score history using an optimized MongoDB aggregation pipeline.
 */
async function getAdminStudents(req, res) {
  try {
    const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');

    // 1. Parse & Validate Pagination Parameters (default: 20, max: 100)
    let page, limit, skip;
    try {
      const parsed = parsePaginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
      page = parsed.page;
      limit = parsed.limit;
      skip = parsed.skip;
    } catch (pagErr) {
      return res.status(pagErr.statusCode || 400).json({
        success: false,
        message: pagErr.message,
      });
    }

    // 2. Build Search and Filter Match Conditions
    const matchConditions = {};

    // Search Filter (name, email, phone)
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const searchStr = req.query.search.trim();
      const escapedSearch = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');

      matchConditions.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { contactNumber: searchRegex }
      ];
    }

    // Status Filter (Active, Trial, Expired, Inactive)
    if (req.query.status && typeof req.query.status === 'string' && req.query.status.trim()) {
      const statusStr = req.query.status.trim();
      matchConditions.status = new RegExp(`^${statusStr}$`, 'i');
    }

    // Course Filter (course_id or course). Students may store either the
    // course title or custom courseId, so resolve both forms before matching.
    const courseFilter = req.query.course_id || req.query.course;
    if (courseFilter && typeof courseFilter === 'string' && courseFilter.trim()) {
      const cleanCourse = courseFilter.trim();
      const escapedCourse = cleanCourse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const courseRegex = new RegExp(escapedCourse, 'i');

      const matchingCourses = await Course.find({
        $or: [
          { courseId: courseRegex },
          { courseTitle: courseRegex },
          ...(mongoose.Types.ObjectId.isValid(cleanCourse) ? [{ _id: cleanCourse }] : [])
        ]
      }).select('courseId courseTitle').lean();

      const courseValues = [cleanCourse];
      matchingCourses.forEach((matchedCourse) => {
        if (matchedCourse.courseId) courseValues.push(matchedCourse.courseId);
        if (matchedCourse.courseTitle) courseValues.push(matchedCourse.courseTitle);
      });
      const uniqueCourseValues = [...new Set(courseValues)];

      // A student can have a legacy primary course plus multiple enrolled
      // course IDs. Match against every representation so an admin can filter
      // by any assigned course without changing the legacy behavior.
      const courseMatchConditions = [
        { course: { $in: uniqueCourseValues } },
        { courseId: { $in: uniqueCourseValues } },
        { courseIds: { $in: uniqueCourseValues } },
      ];

      const matchingCourseObjectIds = matchingCourses
        .map((matchedCourse) => matchedCourse._id)
        .filter(Boolean);
      if (matchingCourseObjectIds.length > 0) {
        courseMatchConditions.push({ courseRef: { $in: matchingCourseObjectIds } });
      }

      if (matchConditions.$or) {
        matchConditions.$and = [
          { $or: matchConditions.$or },
          {
            $or: courseMatchConditions,
          }
        ];
        delete matchConditions.$or;
      } else {
        matchConditions.$or = courseMatchConditions;
      }
    }

    // 3. Fast Parallel Count & Paginated Find using Lean Projections
    const [total, rawStudents] = await Promise.all([
      Student.countDocuments(matchConditions),
      Student.find(matchConditions)
        .select('_id userId name email phone contactNumber dateOfBirth qualification profileImage avatar course courseRef courseId courseIds status accountStatus isApproved subscription joinedDate createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    if (!rawStudents || rawStudents.length === 0) {
      const pagination = buildPaginationResponse(total, page, limit);
      return res.status(200).json({
        success: true,
        message: 'Students retrieved successfully',
        data: [],
        pagination: pagination,
        count: 0,
      });
    }

    // 4. Batch resolve supplementary User and Course data in ONE roundtrip (no N+1)
    const userIdsToFetch = new Set();
    const emailsToFetch = new Set();
    const courseRefsToFetch = new Set();
    const courseIdsToFetch = new Set();
    const courseTitlesToFetch = new Set();
    const studentDocIds = [];

    rawStudents.forEach((s) => {
      studentDocIds.push(s._id);
      if (s.userId && mongoose.Types.ObjectId.isValid(s.userId)) {
        userIdsToFetch.add(s.userId.toString());
      }
      if (s.email) {
        emailsToFetch.add(s.email.toLowerCase().trim());
      }
      if (s.courseRef && mongoose.Types.ObjectId.isValid(s.courseRef)) {
        courseRefsToFetch.add(s.courseRef.toString());
      }
      if (s.courseId) {
        courseIdsToFetch.add(s.courseId.toString().trim());
      }
      if (Array.isArray(s.courseIds)) {
        s.courseIds.forEach((courseId) => {
          const normalizedCourseId = String(courseId || '').trim();
          if (!normalizedCourseId) return;
          courseIdsToFetch.add(normalizedCourseId);
          if (mongoose.Types.ObjectId.isValid(normalizedCourseId)) {
            courseRefsToFetch.add(normalizedCourseId);
          }
        });
      }
      if (s.course) {
        courseTitlesToFetch.add(s.course.toString().trim());
      }
    });

    const userQueryConditions = [];
    if (userIdsToFetch.size > 0) {
      userQueryConditions.push({
        _id: { $in: [...userIdsToFetch].map((id) => new mongoose.Types.ObjectId(id)) },
      });
    }
    if (emailsToFetch.size > 0) {
      userQueryConditions.push({ email: { $in: [...emailsToFetch] } });
    }

    const courseQueryConditions = [];
    if (courseRefsToFetch.size > 0) {
      courseQueryConditions.push({
        _id: { $in: [...courseRefsToFetch].map((id) => new mongoose.Types.ObjectId(id)) },
      });
    }
    if (courseIdsToFetch.size > 0) {
      courseQueryConditions.push({ courseId: { $in: [...courseIdsToFetch] } });
    }
    if (courseTitlesToFetch.size > 0) {
      courseQueryConditions.push({ courseTitle: { $in: [...courseTitlesToFetch] } });
    }

    // Run user lookup, course lookup, and test stats concurrently
    const [matchedUsers, matchedCourses, testStatsAgg] = await Promise.all([
      userQueryConditions.length > 0
        ? User.find({ $or: userQueryConditions })
            .select('_id email phone contactNumber dateOfBirth qualification profileImage avatar')
            .lean()
        : Promise.resolve([]),
      courseQueryConditions.length > 0
        ? Course.find({ $or: courseQueryConditions })
            .select('_id courseId courseTitle category price')
            .lean()
        : Promise.resolve([]),
      TestResult.aggregate([
        { $match: { studentId: { $in: studentDocIds } } },
        {
          $group: {
            _id: '$studentId',
            total_exams_attended: { $sum: 1 },
            average_score: { $avg: '$percentage' },
            passed_exams: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gt: ['$totalMarks', 0] },
                      { $gte: [{ $divide: ['$score', '$totalMarks'] }, 0.5] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const userMap = new Map();
    matchedUsers.forEach((u) => {
      if (u._id) userMap.set(u._id.toString(), u);
      if (u.email) userMap.set(u.email.toLowerCase().trim(), u);
    });

    const courseMap = new Map();
    matchedCourses.forEach((c) => {
      if (c._id) courseMap.set(c._id.toString(), c);
      if (c.courseId) courseMap.set(c.courseId.toString().trim(), c);
      if (c.courseTitle) courseMap.set(c.courseTitle.toString().toLowerCase().trim(), c);
    });

    const statsMap = new Map();
    testStatsAgg.forEach((stat) => {
      if (stat._id) statsMap.set(stat._id.toString(), stat);
    });

    // 5. Format student response objects
    const formattedStudents = rawStudents.map((s) => {
      const uId = s.userId ? s.userId.toString() : '';
      const uEmail = s.email ? s.email.toLowerCase().trim() : '';
      const userObj = userMap.get(uId) || userMap.get(uEmail) || null;

      const cRef = s.courseRef ? s.courseRef.toString() : '';
      const cId = s.courseId ? s.courseId.toString().trim() : '';
      const cTitle = s.course ? s.course.toString().toLowerCase().trim() : '';
      const courseObj = courseMap.get(cRef) || courseMap.get(cId) || courseMap.get(cTitle) || null;

      const formatCourse = (resolvedCourse) => ({
        id: resolvedCourse.courseId || (resolvedCourse._id ? resolvedCourse._id.toString() : ''),
        title: resolvedCourse.courseTitle || '',
        category: resolvedCourse.category || 'General',
        price: resolvedCourse.price || 0,
      });

      // `courseIds` is the canonical multi-course field. Append the legacy
      // primary course values only when they are not already represented, so
      // old single-course records still receive a one-item array.
      const enrolledCourseIdentifiers = [];
      const addCourseIdentifier = (value) => {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue || enrolledCourseIdentifiers.includes(normalizedValue)) return;
        enrolledCourseIdentifiers.push(normalizedValue);
      };

      if (Array.isArray(s.courseIds)) s.courseIds.forEach(addCourseIdentifier);
      addCourseIdentifier(s.courseId);
      addCourseIdentifier(cRef);
      addCourseIdentifier(s.course);

      const enrolledCourseKeys = new Set();
      const enrolledCourses = enrolledCourseIdentifiers.reduce((courses, identifier) => {
        const resolvedCourse =
          courseMap.get(identifier) ||
          courseMap.get(identifier.toLowerCase()) ||
          null;
        if (!resolvedCourse) return courses; // Deleted/invalid course references are safe to ignore.

        const courseKey = resolvedCourse.courseId || resolvedCourse._id.toString();
        if (enrolledCourseKeys.has(courseKey)) return courses;
        enrolledCourseKeys.add(courseKey);
        courses.push(formatCourse(resolvedCourse));
        return courses;
      }, []);

      const statObj = statsMap.get(s._id.toString()) || null;

      const profileImage =
        s.profileImage ||
        s.avatar ||
        userObj?.profileImage ||
        userObj?.avatar ||
        '';

      return {
        id: s._id.toString(),
        student_id: s._id.toString(),
        name: s.name || '',
        email: s.email || '',
        phone: s.phone || s.contactNumber || userObj?.phone || userObj?.contactNumber || '',
        contact_number: s.contactNumber || s.phone || userObj?.contactNumber || userObj?.phone || '',
        date_of_birth: s.dateOfBirth || userObj?.dateOfBirth || '',
        qualification: s.qualification || userObj?.qualification || '',
        profile_image: profileImage,
        avatar: profileImage,
        enrolled_course: {
          id: courseObj?.courseId || (courseObj?._id ? courseObj._id.toString() : (s.course || 'General')),
          title: courseObj?.courseTitle || s.course || 'General',
          category: courseObj?.category || 'General',
          price: courseObj?.price || 0,
        },
        enrolled_courses: enrolledCourses,
        subscription: {
          status: s.status || 'Active',
          type: s.subscription || 'Free',
          joined_date: s.joinedDate || s.createdAt,
        },
        account_status: s.accountStatus || 'Pending',
        is_approved: s.isApproved !== undefined ? s.isApproved : false,
        stats: {
          total_exams_attended: statObj?.total_exams_attended || 0,
          average_score: statObj ? Math.round((statObj.average_score || 0) * 100) / 100 : 0,
          passed_exams: statObj?.passed_exams || 0,
        },
        attended_exams: [],
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      };
    });
    // 3. High-Performance MongoDB Aggregation Pipeline
    const pipeline = [
      // Step A: Apply Initial Filtering
      { $match: matchConditions },

      // Step B: Lookup User Details for additional metadata / avatar
      {
        $lookup: {
          from: 'users',
          let: { uId: '$userId', sEmail: '$email' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uId'] },
                    { $eq: ['$email', '$$sEmail'] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'userDetails'
        }
      },
      {
        $addFields: {
          userObj: { $arrayElemAt: ['$userDetails', 0] }
        }
      },

      // Step C: Lookup Enrolled Course Details
      {
        $lookup: {
          from: 'courses',
          let: { studentCourse: '$course', studentCourseRef: '$courseRef' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$studentCourseRef'] },
                    { $eq: ['$courseId', '$$studentCourse'] },
                    { $eq: ['$courseTitle', '$$studentCourse'] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'courseDetails'
        }
      },
      {
        $addFields: {
          courseObj: { $arrayElemAt: ['$courseDetails', 0] }
        }
      },

      // Step D: Lookup Test Results and Resolve Exam Names & Scores
      {
        $lookup: {
          from: 'testresults',
          let: { studentDocId: '$_id', userDocId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$studentId', '$$studentDocId'] },
                    {
                      $and: [
                        { $ne: ['$$userDocId', null] },
                        { $eq: ['$studentId', '$$userDocId'] }
                      ]
                    }
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'exams',
                localField: 'examId',
                foreignField: '_id',
                as: 'examInfo'
              }
            },
            {
              $unwind: {
                path: '$examInfo',
                preserveNullAndEmptyArrays: true
              }
            },
            {
              $project: {
                exam_id: '$examId',
                title: { $ifNull: ['$examInfo.title', 'Mock Exam'] },
                score: { $ifNull: ['$score', 0] },
                total_marks: { $ifNull: ['$totalMarks', 0] },
                total_attempted: { $ifNull: ['$totalAttempted', 0] },
                total_correct: { $ifNull: ['$totalCorrect', 0] },
                total_wrong: { $ifNull: ['$totalWrong', 0] },
                percentage: {
                  $cond: {
                    if: { $gt: ['$totalMarks', 0] },
                    then: {
                      $round: [
                        { $multiply: [{ $divide: ['$score', '$totalMarks'] }, 100] },
                        2
                      ]
                    },
                    else: 0
                  }
                },
                status: {
                  $cond: {
                    if: {
                      $and: [
                        { $gt: ['$totalMarks', 0] },
                        { $gte: [{ $divide: ['$score', '$totalMarks'] }, 0.5] }
                      ]
                    },
                    then: 'Passed',
                    else: 'Failed'
                  }
                },
                submitted_at: '$createdAt'
              }
            }
          ],
          as: 'attended_exams'
        }
      },

      // Step E: Compute Summary Metrics
      {
        $addFields: {
          total_exams_attended: { $size: '$attended_exams' },
          average_score: {
            $cond: {
              if: { $gt: [{ $size: '$attended_exams' }, 0] },
              then: { $round: [{ $avg: '$attended_exams.percentage' }, 2] },
              else: 0
            }
          },
          passed_exams: {
            $size: {
              $filter: {
                input: '$attended_exams',
                as: 'exam',
                cond: { $eq: ['$$exam.status', 'Passed'] }
              }
            }
          }
        }
      },

      // Step F: Facet for Single-Trip Pagination and Count
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: { $toString: '$_id' },
                student_id: { $toString: '$_id' },
                name: '$name',
                email: '$email',
                phone: {
                  $ifNull: [
                    '$phone',
                    {
                      $ifNull: [
                        '$contactNumber',
                        {
                          $ifNull: [
                            '$userObj.phone',
                            { $ifNull: ['$userObj.contactNumber', ''] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                contact_number: {
                  $ifNull: [
                    '$contactNumber',
                    {
                      $ifNull: [
                        '$phone',
                        {
                          $ifNull: [
                            '$userObj.contactNumber',
                            { $ifNull: ['$userObj.phone', ''] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                date_of_birth: {
                  $ifNull: ['$dateOfBirth', { $ifNull: ['$userObj.dateOfBirth', ''] }]
                },
                qualification: {
                  $ifNull: ['$qualification', { $ifNull: ['$userObj.qualification', ''] }]
                },
                profile_image: {
                  $ifNull: [
                    '$profileImage',
                    {
                      $ifNull: [
                        '$avatar',
                        {
                          $ifNull: [
                            '$userObj.profileImage',
                            { $ifNull: ['$userObj.avatar', ''] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                avatar: {
                  $ifNull: [
                    '$avatar',
                    {
                      $ifNull: [
                        '$profileImage',
                        {
                          $ifNull: [
                            '$userObj.avatar',
                            { $ifNull: ['$userObj.profileImage', ''] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                preferredCourse: {
                  $ifNull: ['$preferredCourse', { $ifNull: ['$course', 'UNANI'] }]
                },
                course: {
                  $ifNull: ['$course', { $ifNull: ['$preferredCourse', 'UNANI'] }]
                },
                status: { $ifNull: ['$status', 'Pending'] },
                accountStatus: { $ifNull: ['$accountStatus', 'Pending'] },
                account_status: { $ifNull: ['$accountStatus', 'Pending'] },
                isApproved: { $ifNull: ['$isApproved', false] },
                is_approved: { $ifNull: ['$isApproved', false] },
                isActive: { $ifNull: ['$isActive', false] },
                is_active: { $ifNull: ['$isActive', false] },
                enrolled_course: {
                  id: {
                    $ifNull: [
                      '$courseObj.courseId',
                      {
                        $ifNull: [
                          { $toString: '$courseObj._id' },
                          { $ifNull: ['$courseId', { $ifNull: ['$course', { $ifNull: ['$preferredCourse', 'UNANI'] }] }] }
                        ]
                      }
                    ]
                  },
                  title: {
                    $ifNull: [
                      '$courseObj.courseTitle',
                      { $ifNull: ['$course', { $ifNull: ['$preferredCourse', 'UNANI'] }] }
                    ]
                  },
                  category: {
                    $ifNull: [
                      '$courseObj.category',
                      {
                        $cond: {
                          if: {
                            $regexMatch: {
                              input: { $ifNull: ['$course', { $ifNull: ['$preferredCourse', ''] }] },
                              regex: 'unani',
                              options: 'i'
                            }
                          },
                          then: 'Unani',
                          else: 'General'
                        }
                      }
                    ]
                  },
                  price: {
                    $ifNull: ['$courseObj.price', 0]
                  }
                },
                subscription: {
                  status: { $ifNull: ['$status', 'Pending'] },
                  type: { $ifNull: ['$subscription', 'Free'] },
                  joined_date: { $ifNull: ['$joinedDate', '$createdAt'] }
                },
                stats: {
                  total_exams_attended: '$total_exams_attended',
                  average_score: '$average_score',
                  passed_exams: '$passed_exams'
                },
                attended_exams: '$attended_exams',
                created_at: '$createdAt',
                updated_at: '$updatedAt'
              }
            }
          ]
        }
      }
    ];

    const pagination = buildPaginationResponse(total, page, limit);

    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data: formattedStudents,
      pagination: pagination,
      count: formattedStudents.length,
    });
  } catch (error) {
    console.error('Error fetching admin students list:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve students list',
      error: error.message
    });
  }
}

/**
 * GET /api/v1/admin/students/:id
 * Fetches single student detailed profile with full attended exams breakdown
 */
async function getAdminStudentById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Student ID format'
      });
    }

    const studentObjectId = new mongoose.Types.ObjectId(id);

    const pipeline = [
      {
        $match: {
          $or: [
            { _id: studentObjectId },
            { userId: studentObjectId }
          ]
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { uId: '$userId', sEmail: '$email' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uId'] },
                    { $eq: ['$email', '$$sEmail'] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'userDetails'
        }
      },
      {
        $addFields: {
          userObj: { $arrayElemAt: ['$userDetails', 0] }
        }
      },
      {
        $lookup: {
          from: 'courses',
          let: { studentCourse: '$course', studentCourseRef: '$courseRef' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$studentCourseRef'] },
                    { $eq: ['$courseId', '$$studentCourse'] },
                    { $eq: ['$courseTitle', '$$studentCourse'] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'courseDetails'
        }
      },
      {
        $addFields: {
          courseObj: { $arrayElemAt: ['$courseDetails', 0] }
        }
      },
      {
        $lookup: {
          from: 'testresults',
          let: { studentDocId: '$_id', userDocId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$studentId', '$$studentDocId'] },
                    {
                      $and: [
                        { $ne: ['$$userDocId', null] },
                        { $eq: ['$studentId', '$$userDocId'] }
                      ]
                    }
                  ]
                }
              }
            },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'exams',
                localField: 'examId',
                foreignField: '_id',
                as: 'examInfo'
              }
            },
            {
              $unwind: {
                path: '$examInfo',
                preserveNullAndEmptyArrays: true
              }
            },
            {
              $project: {
                exam_id: '$examId',
                title: { $ifNull: ['$examInfo.title', 'Mock Exam'] },
                score: { $ifNull: ['$score', 0] },
                total_marks: { $ifNull: ['$totalMarks', 0] },
                total_attempted: { $ifNull: ['$totalAttempted', 0] },
                total_correct: { $ifNull: ['$totalCorrect', 0] },
                total_wrong: { $ifNull: ['$totalWrong', 0] },
                percentage: {
                  $cond: {
                    if: { $gt: ['$totalMarks', 0] },
                    then: {
                      $round: [
                        { $multiply: [{ $divide: ['$score', '$totalMarks'] }, 100] },
                        2
                      ]
                    },
                    else: 0
                  }
                },
                status: {
                  $cond: {
                    if: {
                      $and: [
                        { $gt: ['$totalMarks', 0] },
                        { $gte: [{ $divide: ['$score', '$totalMarks'] }, 0.5] }
                      ]
                    },
                    then: 'Passed',
                    else: 'Failed'
                  }
                },
                submitted_at: '$createdAt'
              }
            }
          ],
          as: 'attended_exams'
        }
      },
      {
        $addFields: {
          total_exams_attended: { $size: '$attended_exams' },
          average_score: {
            $cond: {
              if: { $gt: [{ $size: '$attended_exams' }, 0] },
              then: { $round: [{ $avg: '$attended_exams.percentage' }, 2] },
              else: 0
            }
          },
          passed_exams: {
            $size: {
              $filter: {
                input: '$attended_exams',
                as: 'exam',
                cond: { $eq: ['$$exam.status', 'Passed'] }
              }
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          student_id: { $toString: '$_id' },
          name: '$name',
          email: '$email',
          phone: {
            $ifNull: [
              '$phone',
              {
                $ifNull: [
                  '$contactNumber',
                  {
                    $ifNull: [
                      '$userObj.phone',
                      { $ifNull: ['$userObj.contactNumber', ''] }
                    ]
                  }
                ]
              }
            ]
          },
          contact_number: {
            $ifNull: [
              '$contactNumber',
              {
                $ifNull: [
                  '$phone',
                  {
                    $ifNull: [
                      '$userObj.contactNumber',
                      { $ifNull: ['$userObj.phone', ''] }
                    ]
                  }
                ]
              }
            ]
          },
          date_of_birth: {
            $ifNull: ['$dateOfBirth', { $ifNull: ['$userObj.dateOfBirth', ''] }]
          },
          qualification: {
            $ifNull: ['$qualification', { $ifNull: ['$userObj.qualification', ''] }]
          },
          profile_image: {
            $ifNull: [
              '$profileImage',
              {
                $ifNull: [
                  '$avatar',
                  {
                    $ifNull: [
                      '$userObj.profileImage',
                      { $ifNull: ['$userObj.avatar', ''] }
                    ]
                  }
                ]
              }
            ]
          },
          avatar: {
            $ifNull: [
              '$avatar',
              {
                $ifNull: [
                  '$profileImage',
                  {
                    $ifNull: [
                      '$userObj.avatar',
                      { $ifNull: ['$userObj.profileImage', ''] }
                    ]
                  }
                ]
              }
            ]
          },
          enrolled_course: {
            id: {
              $ifNull: [
                '$courseObj.courseId',
                {
                  $ifNull: [
                    { $toString: '$courseObj._id' },
                    { $ifNull: ['$course', 'General'] }
                  ]
                }
              ]
            },
            title: {
              $ifNull: ['$courseObj.courseTitle', { $ifNull: ['$course', 'General'] }]
            },
            category: {
              $ifNull: ['$courseObj.category', 'General']
            },
            price: {
              $ifNull: ['$courseObj.price', 0]
            }
          },
          subscription: {
            status: { $ifNull: ['$status', 'Active'] },
            type: { $ifNull: ['$subscription', 'Free'] },
            joined_date: { $ifNull: ['$joinedDate', '$createdAt'] }
          },
          // Mirror the exact field names used by the LIST endpoint so the
          // Admin portal's Student Detail page sees the same contract as the list.
          account_status: { $ifNull: ['$accountStatus', 'Pending'] },
          is_approved: { $ifNull: ['$isApproved', false] },
          stats: {
            total_exams_attended: '$total_exams_attended',
            average_score: '$average_score',
            passed_exams: '$passed_exams'
          },
          attended_exams: '$attended_exams',
          created_at: '$createdAt',
          updated_at: '$updatedAt'
        }
      }
    ];

    const result = await Student.aggregate(pipeline);

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // The aggregation preserves the established primary enrolled_course field.
    // Fetch the enrollment source once so the edit screen also receives every
    // assigned course and the canonical stored courseIds array.
    const enrollmentSource = await Student.findOne({
      $or: [
        { _id: studentObjectId },
        { userId: studentObjectId },
      ],
    })
      .select('course courseId courseIds courseRef')
      .lean();
    const studentDetails = result[0];
    studentDetails.courseIds = Array.isArray(enrollmentSource?.courseIds)
      ? enrollmentSource.courseIds.map((courseId) => String(courseId).trim()).filter(Boolean)
      : [];
    studentDetails.enrolled_courses = await getEnrolledCourseDetails(enrollmentSource);

    return res.status(200).json({
      success: true,
      data: studentDetails
    });
  } catch (error) {
    console.error('Error fetching student by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve student details',
      error: error.message
    });
  }
}

/**
 * GET /api/v1/admin/students/:id/results
 * Fetches the exam result history for a specific student by their MongoDB ID.
 * Requires admin Bearer token. Does NOT use the student's own session.
 */
async function getAdminStudentResults(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Student ID format'
      });
    }

    const studentObjectId = new mongoose.Types.ObjectId(id);

    // The testresults collection stores studentId which can reference either
    // the Student document _id OR the linked User _id. We try both.
    let results = await TestResult.find({
      $or: [
        { studentId: studentObjectId }
      ]
    })
      .populate('examId', 'title marksPerQuestion durationMinutes totalQuestions negativeMark negativeMarkPenalty questions')
      .sort({ createdAt: -1 })
      .lean();

    // If no results found by student doc _id, try via the linked userId
    // (for students whose test was submitted using their User _id as studentId)
    if (results.length === 0) {
      const studentDoc = await Student.findById(studentObjectId).lean();
      if (studentDoc && studentDoc.userId) {
        results = await TestResult.find({ studentId: studentDoc.userId })
          .populate('examId', 'title marksPerQuestion durationMinutes totalQuestions negativeMark negativeMarkPenalty questions')
          .sort({ createdAt: -1 })
          .lean();
      }
    }

    const formattedResults = results.map((result) => {
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

      const formattedAnswers = (result.answers || []).map((ans) => {
        let correctOpt = ans.correctOption || ans.correctAnswer || null;
        let targetQ = null;
        if (ans.questionId) {
          targetQ = questionMap.get(ans.questionId.toString());
          if (targetQ) {
            correctOpt = correctOpt || targetQ.correctOption || targetQ.correctAnswer;
          }
        }
        correctOpt = correctOpt ? correctOpt.toString().toUpperCase() : null;
        return {
          questionId: ans.questionId,
          selectedOption: ans.selectedOption !== undefined ? ans.selectedOption : null,
          selectedAnswer: ans.selectedOption !== undefined ? ans.selectedOption : null,
          selectedOptionText: targetQ && targetQ.options && ans.selectedOption ? targetQ.options[ans.selectedOption] : null,
          correctOption: correctOpt || null,
          correctAnswer: correctOpt || null,
          correctOptionText: targetQ && targetQ.options && correctOpt ? (targetQ.options[correctOpt] || null) : null,
          isCorrect: ans.isCorrect
        };
      });

      let examMetadata = exam;
      if (exam) {
        const formattedQuestions = (exam.questions || []).map(q => {
          const cOpt = q.correctOption
            ? q.correctOption.toString().toUpperCase()
            : (q.correctAnswer ? q.correctAnswer.toString().toUpperCase() : null);
          return {
            ...q,
            correctOption: cOpt,
            correctAnswer: cOpt,
            correctOptionText: q.options && cOpt ? q.options[cOpt] : null,
            correctAnswerText: q.options && cOpt ? q.options[cOpt] : null
          };
        });
        
        examMetadata = {
          ...exam,
          questions: formattedQuestions
        };
      }

      return {
        ...result,
        examId: examMetadata,
        answers: formattedAnswers
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedResults.length,
      data: formattedResults
    });
  } catch (error) {
    console.error('Error fetching student exam results by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve student exam results',
      error: error.message
    });
  }
}

/**
 * DELETE /api/v1/admin/students/:id
 * Permanently deletes a student document, linked User account, and associated test results from MongoDB database.
 */
async function deleteAdminStudent(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Student ID format'
      });
    }

    const studentObjectId = new mongoose.Types.ObjectId(id);

    // 1. Find Student document by _id or userId
    const studentDoc = await Student.findOne({
      $or: [
        { _id: studentObjectId },
        { userId: studentObjectId }
      ]
    });

    // 2. Find User document by _id or by studentDoc.userId / email
    let userDoc = null;
    if (studentDoc) {
      if (studentDoc.userId) {
        userDoc = await User.findById(studentDoc.userId);
      }
      if (!userDoc && studentDoc.email) {
        userDoc = await User.findOne({ email: studentDoc.email, role: 'student' });
      }
    } else {
      userDoc = await User.findOne({ _id: studentObjectId, role: 'student' });
    }

    // If neither Student document nor student User account exists
    if (!studentDoc && !userDoc) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Collect all related ObjectIds for permanent deletion
    const studentDocId = studentDoc ? studentDoc._id : null;
    const userDocId = userDoc ? userDoc._id : (studentDoc && studentDoc.userId ? studentDoc.userId : null);

    // 3. Permanent deletion from Student collection using findByIdAndDelete / findOneAndDelete
    if (studentDocId) {
      await Student.findByIdAndDelete(studentDocId);
    } else {
      await Student.findOneAndDelete({ userId: studentObjectId });
    }

    // 4. Permanent deletion from User collection if it's a student account
    if (userDocId) {
      await User.findOneAndDelete({ _id: userDocId, role: 'student' });
    }

    // 5. Cleanup related test history / submissions
    const deleteConditions = [];
    if (studentDocId) deleteConditions.push({ studentId: studentDocId });
    if (userDocId) deleteConditions.push({ studentId: userDocId });
    deleteConditions.push({ studentId: studentObjectId });

    if (deleteConditions.length > 0) {
      await TestResult.deleteMany({ $or: deleteConditions });
    }

    return res.status(200).json({
      success: true,
      message: 'Student permanently deleted from database'
    });
  } catch (error) {
    console.error('Error permanently deleting student:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete student',
      error: error.message
    });
  }
}

/**
 * PUT or PATCH /api/v1/admin/students/:id (also /api/admin/students/:id, /api/students/:id)
 * Updates student details in MongoDB using Mongoose findByIdAndUpdate with runValidators.
 */
async function resolveCourseAssignment(courseId, course) {
  const rawCourseId = courseId !== undefined && courseId !== null
    ? String(courseId).trim()
    : '';
  const rawCourse = course !== undefined && course !== null
    ? String(course).trim()
    : '';
  const selectedCourse = rawCourseId || rawCourse;

  if (!selectedCourse) return null;

  const courseQuery = [
    { courseId: selectedCourse },
    { courseTitle: selectedCourse }
  ];
  if (mongoose.Types.ObjectId.isValid(selectedCourse)) {
    courseQuery.push({ _id: selectedCourse });
  }

  const matchedCourse = await Course.findOne({ $or: courseQuery })
    .select('_id courseId courseTitle')
    .lean();

  if (courseId !== undefined && courseId !== null && !matchedCourse) {
    const error = new Error('Assigned course not found in database');
    error.statusCode = 404;
    throw error;
  }

  return matchedCourse
    ? {
        courseId: matchedCourse.courseId || matchedCourse._id.toString(),
        course: matchedCourse.courseTitle,
        courseRef: matchedCourse._id
      }
    : { course: rawCourse };
}

/**
 * Resolve a submitted multi-course assignment in one database query.
 * The public courseId is persisted in Student.courseIds, while accepting the
 * same identifier forms as the legacy single-course assignment.
 */
async function resolveCourseAssignments(courseIds) {
  if (!Array.isArray(courseIds)) {
    const error = new Error('courseIds must be an array');
    error.statusCode = 400;
    throw error;
  }

  const requestedIds = [];
  const requestedIdSet = new Set();
  courseIds.forEach((value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue || requestedIdSet.has(normalizedValue)) return;
    requestedIdSet.add(normalizedValue);
    requestedIds.push(normalizedValue);
  });

  if (requestedIds.length === 0) return [];

  const objectIds = requestedIds
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));

  const matchedCourses = await Course.find({
    $or: [
      { courseId: { $in: requestedIds } },
      { courseTitle: { $in: requestedIds } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
    ],
  })
    .select('_id courseId courseTitle category price')
    .lean();

  const courseMap = new Map();
  matchedCourses.forEach((matchedCourse) => {
    if (matchedCourse._id) courseMap.set(matchedCourse._id.toString(), matchedCourse);
    if (matchedCourse.courseId) courseMap.set(String(matchedCourse.courseId).trim(), matchedCourse);
    if (matchedCourse.courseTitle) {
      courseMap.set(String(matchedCourse.courseTitle).trim(), matchedCourse);
      courseMap.set(String(matchedCourse.courseTitle).trim().toLowerCase(), matchedCourse);
    }
  });

  const resolvedCourses = requestedIds.map((requestedId) => {
    const matchedCourse = courseMap.get(requestedId) || courseMap.get(requestedId.toLowerCase());
    if (!matchedCourse) {
      const error = new Error(`Assigned course not found in database: ${requestedId}`);
      error.statusCode = 404;
      throw error;
    }
    return matchedCourse;
  });

  return resolvedCourses;
}

/**
 * Resolve every current student enrollment for the detail response without
 * changing its established singular enrolled_course contract.
 */
async function getEnrolledCourseDetails(student) {
  if (!student) return [];

  const identifiers = [];
  const seenIdentifiers = new Set();
  const addIdentifier = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue || seenIdentifiers.has(normalizedValue)) return;
    seenIdentifiers.add(normalizedValue);
    identifiers.push(normalizedValue);
  };

  if (Array.isArray(student.courseIds)) student.courseIds.forEach(addIdentifier);
  addIdentifier(student.courseId);
  addIdentifier(student.courseRef);
  addIdentifier(student.course);

  if (identifiers.length === 0) return [];

  const objectIds = identifiers
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const courses = await Course.find({
    $or: [
      { courseId: { $in: identifiers } },
      { courseTitle: { $in: identifiers } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
    ],
  })
    .select('_id courseId courseTitle category price')
    .lean();

  const courseMap = new Map();
  courses.forEach((courseDoc) => {
    if (courseDoc._id) courseMap.set(courseDoc._id.toString(), courseDoc);
    if (courseDoc.courseId) courseMap.set(String(courseDoc.courseId).trim(), courseDoc);
    if (courseDoc.courseTitle) {
      courseMap.set(String(courseDoc.courseTitle).trim(), courseDoc);
      courseMap.set(String(courseDoc.courseTitle).trim().toLowerCase(), courseDoc);
    }
  });

  const resolvedCourseKeys = new Set();
  return identifiers.reduce((enrolledCourses, identifier) => {
    const courseDoc = courseMap.get(identifier) || courseMap.get(identifier.toLowerCase());
    if (!courseDoc) return enrolledCourses;

    const courseKey = courseDoc.courseId || courseDoc._id.toString();
    if (resolvedCourseKeys.has(courseKey)) return enrolledCourses;
    resolvedCourseKeys.add(courseKey);
    enrolledCourses.push({
      id: courseDoc.courseId || courseDoc._id.toString(),
      title: courseDoc.courseTitle || '',
      category: courseDoc.category || 'General',
      price: courseDoc.price || 0,
    });
    return enrolledCourses;
  }, []);
}

async function updateAdminStudent(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Student ID format'
      });
    }

    const studentObjectId = new mongoose.Types.ObjectId(id);

    // Build update object based on allowed fields from request payload
    const updateFields = {};

    const nameVal = req.body.name || req.body.fullName;
    if (nameVal !== undefined && nameVal !== null) {
      updateFields.name = String(nameVal).trim();
    }

    if (req.body.email !== undefined && req.body.email !== null) {
      updateFields.email = String(req.body.email).trim().toLowerCase();
    }

    const phoneVal = req.body.phone || req.body.contactNumber;
    if (phoneVal !== undefined && phoneVal !== null) {
      const cleanPhone = String(phoneVal).trim();
      updateFields.phone = cleanPhone;
      updateFields.contactNumber = cleanPhone;
    }

    const dobVal = req.body.dob || req.body.dateOfBirth;
    if (dobVal !== undefined && dobVal !== null) {
      updateFields.dateOfBirth = String(dobVal).trim();
    }

    if (req.body.qualification !== undefined && req.body.qualification !== null) {
      updateFields.qualification = String(req.body.qualification).trim();
    }

    const hasCourseIds = Object.prototype.hasOwnProperty.call(req.body, 'courseIds');
    if (hasCourseIds) {
      const resolvedCourses = await resolveCourseAssignments(req.body.courseIds);
      updateFields.courseIds = resolvedCourses.map((courseDoc) => courseDoc.courseId || courseDoc._id.toString());

      // The first selected course remains the legacy primary assignment for
      // existing consumers that use course/courseId/courseRef.
      if (resolvedCourses.length > 0) {
        const primaryCourse = resolvedCourses[0];
        updateFields.courseId = primaryCourse.courseId || primaryCourse._id.toString();
        updateFields.course = primaryCourse.courseTitle || '';
        updateFields.courseRef = primaryCourse._id;
      } else {
        updateFields.courseId = '';
        updateFields.course = '';
        updateFields.courseRef = null;
      }
    } else if (
      (req.body.courseId !== undefined && req.body.courseId !== null) ||
      (req.body.course !== undefined && req.body.course !== null)
    ) {
      const courseAssignment = await resolveCourseAssignment(req.body.courseId, req.body.course);
      if (courseAssignment.courseId) updateFields.courseId = courseAssignment.courseId;
      if (courseAssignment.courseRef) updateFields.courseRef = courseAssignment.courseRef;
      updateFields.course = courseAssignment.course;
    }

    if (req.body.subscription !== undefined && req.body.subscription !== null) {
      updateFields.subscription = String(req.body.subscription).trim();
    }

    if (req.body.status !== undefined && req.body.status !== null) {
      // Normalise to the exact enum casing the schema requires:
      //   ['Active', 'Inactive', 'Trial', 'Expired']
      const STATUS_ENUM = ['Pending', 'Active', 'Inactive', 'Trial', 'Expired'];
      const rawStatus = String(req.body.status).trim();
      const normStatus = STATUS_ENUM.find(
        (s) => s.toLowerCase() === rawStatus.toLowerCase()
      );
      if (!normStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid status value "${rawStatus}". Allowed values: ${STATUS_ENUM.join(', ')}`,
          code: 'INVALID_STATUS',
        });
      }
      updateFields.status = normStatus;
    }

    if (req.body.accountStatus !== undefined && req.body.accountStatus !== null) {
      // Normalise to the exact enum casing the schema requires:
      //   ['Pending', 'Approved', 'Rejected', 'Suspended']
      const ACCOUNT_STATUS_ENUM = ['Pending', 'Approved', 'Rejected', 'Suspended'];
      const rawAccStatus = String(req.body.accountStatus).trim();
      const normAccStatus = ACCOUNT_STATUS_ENUM.find(
        (s) => s.toLowerCase() === rawAccStatus.toLowerCase()
      );
      if (!normAccStatus) {
        return res.status(400).json({
          success: false,
          message: `Invalid accountStatus value "${rawAccStatus}". Allowed values: ${ACCOUNT_STATUS_ENUM.join(', ')}`,
          code: 'INVALID_ACCOUNT_STATUS',
        });
      }
      updateFields.accountStatus = normAccStatus;
      // Keep isApproved in sync when accountStatus changes via the generic update
      updateFields.isApproved = normAccStatus === 'Approved';
    }

    if (req.body.profileImage !== undefined && req.body.profileImage !== null) {
      updateFields.profileImage = String(req.body.profileImage).trim();
    }

    if (req.body.avatar !== undefined && req.body.avatar !== null) {
      updateFields.avatar = String(req.body.avatar).trim();
    }

    // 1. Database Operation: findByIdAndUpdate with runValidators: true and new: true
    let updatedStudent = await Student.findByIdAndUpdate(
      studentObjectId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // 2. If not found by Student _id, check if id matches a linked userId
    if (!updatedStudent) {
      updatedStudent = await Student.findOneAndUpdate(
        { userId: studentObjectId },
        { $set: updateFields },
        { new: true, runValidators: true }
      );
    }

    // If student record does not exist in MongoDB
    if (!updatedStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // 3. Sync updated fields to linked User account if exists
    try {
      const userUpdateFields = {};
      if (updateFields.name) userUpdateFields.name = updateFields.name;
      if (updateFields.email) userUpdateFields.email = updateFields.email;
      if (updateFields.phone) {
        userUpdateFields.phone = updateFields.phone;
        userUpdateFields.contactNumber = updateFields.phone;
      }
      if (updateFields.dateOfBirth) userUpdateFields.dateOfBirth = updateFields.dateOfBirth;
      if (updateFields.qualification) userUpdateFields.qualification = updateFields.qualification;
      if (Object.prototype.hasOwnProperty.call(updateFields, 'courseIds')) {
        // User.courseIds is already populated during registration and read by
        // authentication/course-access code, so keep this existing duplicate
        // enrollment representation in sync with Student.courseIds.
        userUpdateFields.courseIds = updateFields.courseIds;
      }
      if (updateFields.profileImage !== undefined) {
        userUpdateFields.profileImage = updateFields.profileImage;
        userUpdateFields.avatar = updateFields.profileImage;
      }
      if (updateFields.avatar !== undefined) {
        userUpdateFields.avatar = updateFields.avatar;
        userUpdateFields.profileImage = updateFields.avatar;
      }

      if (Object.keys(userUpdateFields).length > 0) {
        if (updatedStudent.userId) {
          await User.findByIdAndUpdate(updatedStudent.userId, { $set: userUpdateFields });
        } else if (updatedStudent.email) {
          await User.findOneAndUpdate({ email: updatedStudent.email, role: 'student' }, { $set: userUpdateFields });
        }
      }
    } catch (syncErr) {
      console.warn('Notice: Sync to User model failed:', syncErr.message);
    }

    // 4. Response: 200 OK with success: true, message, and updatedStudent object
    return res.status(200).json({
      success: true,
      message: 'Student details updated successfully',
      data: updatedStudent
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    // 400 Bad Request for Mongoose schema validation failure
    if (error.name === 'ValidationError') {
      console.warn('Student update validation error:', error.message);
      return res.status(400).json({
        success: false,
        message: error.message,
        error: error.message
      });
    }

    // 400 Bad Request for duplicate email
    if (error.code === 11000) {
      console.warn('Student update duplicate email error:', error.message);
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
        error: 'Duplicate key error'
      });
    }

    console.error('Error updating student details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update student details',
      error: error.message
    });
  }
}

/**
 * POST /api/v1/admin/students
 * Creates a new student record and optional linked user account.
 */
async function createAdminStudent(req, res) {
  try {
    const {
      name,
      email,
      phone,
      dateOfBirth,
      qualification,
      course,
      courseId,
      subscription,
      status,
      password
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required fields',
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const existingStudent = await Student.findOne({ email: cleanEmail });
    if (existingStudent) {
      return res.status(400).json({
        success: false,
        message: 'Student with this email already exists',
      });
    }

    let linkedUser = await User.findOne({ email: cleanEmail });
    if (!linkedUser && password) {
      linkedUser = await User.create({
        name: String(name).trim(),
        email: cleanEmail,
        password: password,
        role: 'student',
        phone: phone ? String(phone).trim() : '',
        contactNumber: phone ? String(phone).trim() : '',
        qualification: qualification ? String(qualification).trim() : '',
        dateOfBirth: dateOfBirth ? String(dateOfBirth).trim() : '',
      });
    }

    const courseAssignment = await resolveCourseAssignment(courseId, course);
    const statusValues = ['Pending', 'Active', 'Inactive', 'Trial', 'Expired'];
    const selectedStatus = status ? String(status).trim() : 'Active';
    const normalizedStatus = statusValues.find(
      (value) => value.toLowerCase() === selectedStatus.toLowerCase()
    );
    if (!normalizedStatus) {
      return res.status(400).json({
        success: false,
        message: `Invalid status value "${selectedStatus}". Allowed values: ${statusValues.join(', ')}`,
        code: 'INVALID_STATUS'
      });
    }

    const student = await Student.create({
      userId: linkedUser ? linkedUser._id : null,
      name: String(name).trim(),
      email: cleanEmail,
      phone: phone ? String(phone).trim() : '',
      contactNumber: phone ? String(phone).trim() : '',
      dateOfBirth: dateOfBirth ? String(dateOfBirth).trim() : '',
      qualification: qualification ? String(qualification).trim() : '',
      ...(courseAssignment || { course: 'General' }),
      subscription: subscription ? String(subscription).trim() : 'Free',
      status: normalizedStatus,
      joinedDate: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: student,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    console.error('Error creating student:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create student',
      error: error.message,
    });
  }
}

/**
 * GET /api/v1/admin/students/export (or /api/student_new/export)
 * Exports student scores and profile list as CSV file or JSON download.
 */
async function exportStudentsScores(req, res) {
  try {
    const students = await Student.find()
      .select('_id userId name email phone contactNumber course subscription status joinedDate createdAt')
      .lean();
    
    const acceptHeader = req.headers.accept || '';
    const format = req.query.format || (acceptHeader.includes('text/csv') ? 'csv' : 'json');

    const testResults = await TestResult.find()
      .select('studentId score')
      .lean();

    const resultsMap = new Map();

    testResults.forEach(tr => {
      const sId = tr.studentId ? tr.studentId.toString() : null;
      if (sId) {
        if (!resultsMap.has(sId)) resultsMap.set(sId, []);
        resultsMap.get(sId).push(tr);
      }
    });

    const exportData = students.map(st => {
      const sId = st._id.toString();
      const uId = st.userId ? st.userId.toString() : null;
      const studentResults = [...(resultsMap.get(sId) || []), ...(uId ? (resultsMap.get(uId) || []) : [])];
      
      const totalExams = studentResults.length;
      const totalScore = studentResults.reduce((acc, r) => acc + (r.score || 0), 0);
      const avgScore = totalExams > 0 ? (totalScore / totalExams).toFixed(2) : 0;

      return {
        id: sId,
        name: st.name || '',
        email: st.email || '',
        phone: st.phone || st.contactNumber || '',
        course: st.course || 'General',
        subscription: st.subscription || 'Free',
        status: st.status || 'Active',
        totalExamsAttended: totalExams,
        averageScore: avgScore,
        joinedDate: st.joinedDate || st.createdAt || ''
      };
    });

    if (format === 'csv') {
      const headers = ['ID', 'Name', 'Email', 'Phone', 'Course', 'Subscription', 'Status', 'Total Exams Attended', 'Average Score', 'Joined Date'];
      const csvRows = [headers.join(',')];

      exportData.forEach(row => {
        const values = [
          `"${row.id}"`,
          `"${(row.name || '').replace(/"/g, '""')}"`,
          `"${(row.email || '').replace(/"/g, '""')}"`,
          `"${(row.phone || '').replace(/"/g, '""')}"`,
          `"${(row.course || '').replace(/"/g, '""')}"`,
          `"${(row.subscription || '').replace(/"/g, '""')}"`,
          `"${(row.status || '').replace(/"/g, '""')}"`,
          row.totalExamsAttended,
          row.averageScore,
          `"${row.joinedDate}"`
        ];
        csvRows.push(values.join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="student_scores_export.csv"');
      return res.status(200).send(csvRows.join('\n'));
    }

    return res.status(200).json({
      success: true,
      count: exportData.length,
      data: exportData
    });
  } catch (error) {
    console.error('Error exporting student scores:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export student scores',
      error: error.message
    });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// ENUM CONSTANTS — must mirror Student.js schema exactly
// ─────────────────────────────────────────────────────────────────────────────
const STUDENT_STATUS_ENUM       = ['Pending', 'Active', 'Inactive', 'Trial', 'Expired'];
const STUDENT_ACCOUNT_STATUS_ENUM = ['Pending', 'Approved', 'Rejected', 'Suspended'];

/**
 * Private helper — finds the student + linked user, writes the given status
 * values to both documents, and returns { studentDoc, userDoc, responseStudent }.
 *
 * @param {string}  id            MongoDB ObjectId string (from req.params.id)
 * @param {object}  statusPatch   Fields to write: { accountStatus, status, isApproved, isActive }
 * @param {string|null} adminId   The acting admin's _id string
 */
async function _setStudentAccountStatus(id, statusPatch, adminId) {
  // 1. Find Student document (by _id, then by userId)
  let studentDoc = await Student.findById(id);
  if (!studentDoc) {
    studentDoc = await Student.findOne({ userId: id });
  }

  let userDoc = null;

  if (!studentDoc) {
    // Last resort: the caller passed a User._id for a student account
    const candidate = await User.findById(id);
    if (candidate && (candidate.role || '').toLowerCase() === 'student') {
      userDoc = candidate;
    }
  } else {
    // Load linked User for mirroring
    if (studentDoc.userId) {
      userDoc = await User.findById(studentDoc.userId);
    }
    if (!userDoc && studentDoc.email) {
      userDoc = await User.findOne({ email: studentDoc.email });
    }
  }

  if (!studentDoc && !userDoc) return null;

  // 2. Write to Student document
  if (studentDoc) {
    studentDoc.accountStatus = statusPatch.accountStatus;   // enum: ['Pending','Approved','Rejected','Suspended']
    studentDoc.status        = statusPatch.status;          // enum: ['Pending','Active','Inactive','Trial','Expired']
    studentDoc.isApproved    = statusPatch.isApproved;
    studentDoc.isActive      = statusPatch.isActive;
    studentDoc.approvedAt    = new Date();
    studentDoc.approvedBy    = adminId;
    await studentDoc.save();
  }

  // 3. Mirror to User document (User model has no enum for these — uses strict:false)
  if (userDoc) {
    userDoc.set('isApproved',    statusPatch.isApproved,    { strict: false });
    userDoc.set('isActive',      statusPatch.isActive,      { strict: false });
    userDoc.set('accountStatus', statusPatch.accountStatus, { strict: false });
    userDoc.set('approvedAt',    new Date(),                { strict: false });
    await userDoc.save();
  }

  // 4. Build clean response object
  const responseStudent = studentDoc
    ? {
        id:              studentDoc._id.toString(),
        name:            studentDoc.name,
        email:           studentDoc.email,
        contactNumber:   studentDoc.contactNumber || studentDoc.phone || '',
        qualification:   studentDoc.qualification || '',
        preferredCourse: studentDoc.preferredCourse || '',
        course:          studentDoc.course || '',
        subscription:    studentDoc.subscription || '',
        status:          studentDoc.status,
        isActive:        studentDoc.isActive,
        isApproved:      studentDoc.isApproved,
        accountStatus:   studentDoc.accountStatus,
        approvedAt:      studentDoc.approvedAt,
        approvedBy:      adminId,
        updatedAt:       studentDoc.updatedAt,
      }
    : {
        id:            userDoc._id.toString(),
        name:          userDoc.name,
        email:         userDoc.email,
        isApproved:    statusPatch.isApproved,
        isActive:      statusPatch.isActive,
        accountStatus: statusPatch.accountStatus,
        approvedAt:    new Date(),
        approvedBy:    adminId,
      };

  return { studentDoc, userDoc, responseStudent };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PUT   /api/v1/admin/students/:id/approve
 * @route   PATCH /api/v1/admin/students/:id/approve
 * @route   PUT   /api/admin/students/:id/approve
 * @desc    Approve a student account.
 *          Sets accountStatus → 'Approved', status → 'Active', isApproved → true.
 *          Optionally pass { accountStatus: 'Suspended' | 'Rejected' | 'Pending' }
 *          in the body to use this single endpoint for all status transitions.
 * @access  Private — Admin / Superadmin
 *
 * Body (all optional):
 *   accountStatus {String}  Default: 'Approved'. One of: Approved | Rejected | Suspended | Pending
 */
async function approveStudent(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID format.', code: 'INVALID_ID' });
    }

    // Parse accountStatus from body — default to 'Approved'
    const rawAccountStatus = (req.body.accountStatus || 'Approved').toString().trim();
    const matchedAccountStatus = STUDENT_ACCOUNT_STATUS_ENUM.find(
      (s) => s.toLowerCase() === rawAccountStatus.toLowerCase()
    );

    if (!matchedAccountStatus) {
      return res.status(400).json({
        success: false,
        message: `Invalid accountStatus. Allowed values: ${STUDENT_ACCOUNT_STATUS_ENUM.join(', ')}`,
        code: 'INVALID_ACCOUNT_STATUS',
      });
    }

    // Map accountStatus → legacy status field (exact enum values from schema)
    const STATUS_MAP = {
      Approved:  'Active',    // accountStatus='Approved'  → status='Active'
      Rejected:  'Inactive',  // accountStatus='Rejected'  → status='Inactive'
      Suspended: 'Inactive',  // accountStatus='Suspended' → status='Inactive'
      Pending:   'Pending',   // accountStatus='Pending'   → status='Pending'
    };

    const adminId = req.admin?._id || req.admin?.id || req.user?._id || req.user?.id || null;
    const adminEmail = req.admin?.email || req.user?.email || 'unknown';

    const result = await _setStudentAccountStatus(id, {
      accountStatus: matchedAccountStatus,           // exact schema enum value
      status:        STATUS_MAP[matchedAccountStatus], // exact schema enum value
      isApproved:    matchedAccountStatus === 'Approved',
      isActive:      matchedAccountStatus === 'Approved',
    }, adminId);

    if (!result) {
      return res.status(404).json({ success: false, message: 'Student not found.', code: 'STUDENT_NOT_FOUND' });
    }

    console.log(`[approveStudent] Admin ${adminEmail} → student ${result.responseStudent.id} | accountStatus: ${matchedAccountStatus}`);

    return res.status(200).json({
      success: true,
      message: `Student account ${matchedAccountStatus.toLowerCase()} successfully.`,
      student: result.responseStudent,
    });
  } catch (error) {
    console.error('[approveStudent] Error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message, code: 'VALIDATION_ERROR' });
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid student ID format.', code: 'INVALID_ID' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error while approving student.', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PUT   /api/v1/admin/students/:id/reject
 * @route   PATCH /api/v1/admin/students/:id/reject
 * @route   PUT   /api/admin/students/:id/reject
 * @desc    Reject a student account.
 *          Sets accountStatus → 'Rejected', status → 'Inactive', isApproved → false.
 * @access  Private — Admin / Superadmin
 */
async function rejectStudent(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID format.', code: 'INVALID_ID' });
    }

    const adminId = req.admin?._id || req.admin?.id || req.user?._id || req.user?.id || null;
    const adminEmail = req.admin?.email || req.user?.email || 'unknown';

    const result = await _setStudentAccountStatus(id, {
      accountStatus: 'Rejected',  // exact schema enum value
      status:        'Inactive',  // exact schema enum value
      isApproved:    false,
      isActive:      false,
    }, adminId);

    if (!result) {
      return res.status(404).json({ success: false, message: 'Student not found.', code: 'STUDENT_NOT_FOUND' });
    }

    console.log(`[rejectStudent] Admin ${adminEmail} → student ${result.responseStudent.id} | accountStatus: Rejected`);

    return res.status(200).json({
      success: true,
      message: 'Student account rejected successfully.',
      student: result.responseStudent,
    });
  } catch (error) {
    console.error('[rejectStudent] Error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message, code: 'VALIDATION_ERROR' });
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid student ID format.', code: 'INVALID_ID' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error while rejecting student.', error: error.message });
  }
}





/**
 * POST/PUT /api/admin/students/:id/avatar
 * Upload or update student avatar/profile image.
 */
async function uploadStudentAvatar(req, res) {
  try {
    const { id } = req.params;
    let imageUrl = '';

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      imageUrl = file.cloudinaryUrl || file.secure_url || file.url || file.path || '';
    } else if (req.file) {
      imageUrl = req.file.cloudinaryUrl || req.file.secure_url || req.file.url || req.file.path || '';
    }

    if (!imageUrl) {
      imageUrl = req.body.profileImage || req.body.avatar || req.body.imageUrl || req.body.url || '';
    }

    imageUrl = String(imageUrl || '').trim();

    let student = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const studentObjId = new mongoose.Types.ObjectId(id);
      student = await Student.findById(studentObjId);
      if (!student) {
        student = await Student.findOne({ userId: studentObjId });
      }
    }
    if (!student) {
      student = await Student.findOne({ $or: [{ studentId: id }, { email: id }] });
    }
    if (!student) {
      const user = await User.findOne({
        $or: [
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
          { email: id }
        ]
      });
      if (user) {
        student = await Student.findOne({ $or: [{ userId: user._id }, { email: user.email }] });
        if (!student) {
          student = await Student.create({
            userId: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone || user.contactNumber,
            profileImage: imageUrl,
            avatar: imageUrl,
            course: 'General',
            subscription: 'Free',
            status: 'Active',
          });
        }
        await User.findByIdAndUpdate(user._id, { $set: { profileImage: imageUrl, avatar: imageUrl } });
      }
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    student.profileImage = imageUrl;
    student.avatar = imageUrl;
    await student.save();

    if (student.userId) {
      await User.findByIdAndUpdate(student.userId, { $set: { profileImage: imageUrl, avatar: imageUrl } });
    } else if (student.email) {
      await User.findOneAndUpdate({ email: student.email }, { $set: { profileImage: imageUrl, avatar: imageUrl } });
    }

    return res.status(200).json({
      success: true,
      message: 'Student profile image updated successfully',
      data: {
        studentId: student._id.toString(),
        profileImage: imageUrl,
        avatar: imageUrl,
      },
      profileImage: imageUrl,
    });
  } catch (error) {
    console.error('Error in uploadStudentAvatar:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update student profile image',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/admin/students/:id/avatar
 * Remove student avatar/profile image.
 */
async function deleteStudentAvatar(req, res) {
  try {
    const { id } = req.params;
    let student = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const studentObjId = new mongoose.Types.ObjectId(id);
      student = await Student.findById(studentObjId);
      if (!student) {
        student = await Student.findOne({ userId: studentObjId });
      }
    }
    if (!student) {
      student = await Student.findOne({ $or: [{ studentId: id }, { email: id }] });
    }
    if (!student) {
      const user = await User.findOne({
        $or: [
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
          { email: id }
        ]
      });
      if (user) {
        student = await Student.findOne({ $or: [{ userId: user._id }, { email: user.email }] });
        await User.findByIdAndUpdate(user._id, { $set: { profileImage: '', avatar: '' } });
      }
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    student.profileImage = '';
    student.avatar = '';
    await student.save();

    if (student.userId) {
      await User.findByIdAndUpdate(student.userId, { $set: { profileImage: '', avatar: '' } });
    } else if (student.email) {
      await User.findOneAndUpdate({ email: student.email }, { $set: { profileImage: '', avatar: '' } });
    }

    return res.status(200).json({
      success: true,
      message: 'Student profile image removed successfully',
      profileImage: '',
    });
  } catch (error) {
    console.error('Error in deleteStudentAvatar:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove student profile image',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/students/:id/avatar
 * Return student avatar/profile image.
 */
async function getStudentAvatar(req, res) {
  try {
    const { id } = req.params;
    let student = null;
    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const studentObjId = new mongoose.Types.ObjectId(id);
      student = await Student.findById(studentObjId).lean();
      if (!student) {
        user = await User.findById(studentObjId).lean();
      }
    }
    if (!student && !user) {
      student = await Student.findOne({ $or: [{ studentId: id }, { email: id }] }).lean();
      if (!student) {
        user = await User.findOne({ email: id }).lean();
      }
    }

    const profileImage = student?.profileImage || student?.avatar || user?.profileImage || user?.avatar || '';

    return res.status(200).json({
      success: true,
      profileImage,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get student avatar',
      error: error.message,
    });
  }
}

module.exports = {
  getAdminStudents,
  getAdminStudentById,
  getStudentById: getAdminStudentById,
  getAdminStudentResults,
  updateAdminStudent,
  updateStudent: updateAdminStudent,
  deleteAdminStudent,
  deleteStudent: deleteAdminStudent,
  createAdminStudent,
  createStudent: createAdminStudent,
  exportStudentsScores,
  approveStudent,
  rejectStudent,
  uploadStudentAvatar,
  deleteStudentAvatar,
  getStudentAvatar,
};

