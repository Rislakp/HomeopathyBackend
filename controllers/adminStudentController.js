const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');

/**
 * Sync registered student users from User collection into Student collection if missing
 */
async function syncStudentUsers() {
  try {
    const studentUsers = await User.find({ role: 'student' }).lean();
    for (const u of studentUsers) {
      const exists = await Student.findOne({
        $or: [{ userId: u._id }, { email: u.email }]
      });
      if (!exists) {
        await Student.create({
          userId: u._id,
          name: u.name,
          email: u.email,
          phone: u.phone || u.contactNumber,
          contactNumber: u.contactNumber || u.phone,
          dateOfBirth: u.dateOfBirth,
          qualification: u.qualification,
          course: 'General',
          subscription: 'Free',
          status: 'Active',
          joinedDate: u.createdAt || new Date()
        });
      }
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
    // 1. Parse Pagination Parameters
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100; // Cap page limit at 100

    const skip = (page - 1) * limit;

    // Optional background sync to ensure data consistency
    syncStudentUsers().catch(() => {});

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

    // Course Filter (course_id or course)
    const courseFilter = req.query.course_id || req.query.course;
    if (courseFilter && typeof courseFilter === 'string' && courseFilter.trim()) {
      const cleanCourse = courseFilter.trim();
      const escapedCourse = cleanCourse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const courseRegex = new RegExp(escapedCourse, 'i');

      if (matchConditions.$or) {
        matchConditions.$and = [
          { $or: matchConditions.$or },
          {
            $or: [
              { course: courseRegex },
              { 'courseObj.courseId': courseRegex },
              { 'courseObj.courseTitle': courseRegex }
            ]
          }
        ];
        delete matchConditions.$or;
      } else {
        matchConditions.$or = [
          { course: courseRegex }
        ];
      }
    }

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
          let: { studentCourse: '$course' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
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

    const result = await Student.aggregate(pipeline);

    const metadata = (result[0] && result[0].metadata[0]) || { total: 0 };
    const students = (result[0] && result[0].data) || [];
    const total = metadata.total;
    const totalPages = Math.ceil(total / limit) || (total > 0 ? 1 : 0);

    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data: {
        students,
        pagination: {
          total,
          page,
          limit,
          total_pages: totalPages,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      },
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      count: students.length
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
          let: { studentCourse: '$course' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
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

    return res.status(200).json({
      success: true,
      data: result[0]
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

module.exports = {
  getAdminStudents,
  getAdminStudentById
};
