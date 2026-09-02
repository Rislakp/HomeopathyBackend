const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const TestResult = require('../src/common/models/testResult.model');
const Course = require('../models/Course');

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
        if (!correctOpt && ans.questionId) {
          const targetQ = questionMap.get(ans.questionId.toString());
          if (targetQ) {
            correctOpt = targetQ.correctOption;
          }
        }
        return {
          questionId: ans.questionId,
          selectedOption: ans.selectedOption !== undefined ? ans.selectedOption : null,
          correctOption: correctOpt || null,
          isCorrect: ans.isCorrect
        };
      });

      let examMetadata = exam;
      if (exam && exam.questions) {
        const { questions, ...restExam } = exam;
        examMetadata = restExam;
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

    if (req.body.course !== undefined && req.body.course !== null) {
      updateFields.course = String(req.body.course).trim();
    }

    if (req.body.subscription !== undefined && req.body.subscription !== null) {
      updateFields.subscription = String(req.body.subscription).trim();
    }

    if (req.body.status !== undefined && req.body.status !== null) {
      updateFields.status = String(req.body.status).trim();
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


// =========================================================
// Functions merged from adminStudent.controller.js
// =========================================================

const escapeCsvValue = (val) => {
  if (val === null || val === undefined) {
    return '""';
  }

  let str = String(val);

  // If date object or ISO string that is valid date
  if (val instanceof Date) {
    str = val.toISOString().split('T')[0];
  }

  // If value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  } else {
    // Wrap all string fields in quotes for clean consistency
    str = `"${str}"`;
  }

  return str;
};

const formatExamScoresData = (examScores) => {
  if (!examScores || !Array.isArray(examScores) || examScores.length === 0) {
    return {
      scoresFormatted: 'N/A',
      averagePercentage: 'N/A',
      examCount: 0,
    };
  }

  const scoreStrings = [];
  let totalPct = 0;
  let validCount = 0;

  examScores.forEach((exam) => {
    const title = exam.examTitle || exam.title || 'Exam';
    const score = exam.score !== undefined ? exam.score : 0;
    const maxScore = exam.maxScore !== undefined ? exam.maxScore : (exam.total_marks || 100);
    const pct = exam.percentage !== undefined ? exam.percentage : (maxScore > 0 ? Math.round((score / maxScore) * 100) : 0);
    const grade = exam.grade || exam.status ? ` [${exam.grade || exam.status}]` : '';

    scoreStrings.push(`${title}: ${score}/${maxScore} (${pct}%)${grade}`);
    totalPct += pct;
    validCount += 1;
  });

  const avgPct = validCount > 0 ? `${(totalPct / validCount).toFixed(1)}%` : 'N/A';

  return {
    scoresFormatted: scoreStrings.join('; '),
    averagePercentage: avgPct,
    examCount: validCount,
  };
};

/**
 * @desc    Export students list and exam scores as CSV
 * @route   GET /api/admin/students/export
 * @access  Private / Admin
 */
async function exportStudentsScores(req, res) {
  try {
    const { status, course, search, startDate, endDate } = req.query;

    // Build filter
    const filter = {};

    if (status && status.trim() && status.toLowerCase() !== 'all') {
      filter.status = { $regex: new RegExp(`^${status.trim()}$`, 'i') };
    }

    if (course && course.trim() && course.toLowerCase() !== 'all') {
      filter.course = { $regex: new RegExp(course.trim(), 'i') };
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { course: searchRegex },
        { subscription: searchRegex },
      ];
    }

    if (startDate || endDate) {
      filter.joinedDate = {};
      if (startDate) {
        filter.joinedDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.joinedDate.$lte = end;
      }
    }

    // Fetch students using aggregation for consistent testresults lookup
    const pipeline = [
      { $match: filter },
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
                title: { $ifNull: ['$examInfo.title', 'Mock Exam'] },
                score: { $ifNull: ['$score', 0] },
                total_marks: { $ifNull: ['$totalMarks', 0] },
                percentage: {
                  $cond: {
                    if: { $gt: ['$totalMarks', 0] },
                    then: { $round: [{ $multiply: [{ $divide: ['$score', '$totalMarks'] }, 100] }, 2] },
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
                }
              }
            }
          ],
          as: 'attended_exams'
        }
      },
      { $sort: { joinedDate: -1, createdAt: -1 } }
    ];

    const students = mongoose.connection.readyState === 1
      ? await Student.aggregate(pipeline)
      : [];

    // Fetch all courses to enrich student data with course details
    const courses = mongoose.connection.readyState === 1
      ? await Course.find().lean()
      : [];
    const courseMap = new Map();

    courses.forEach((c) => {
      if (c.courseTitle) {
        courseMap.set(c.courseTitle.toLowerCase().trim(), c);
      }
      if (c.courseId) {
        courseMap.set(c.courseId.toLowerCase().trim(), c);
      }
      if (c._id) {
        courseMap.set(c._id.toString(), c);
      }
    });

    // Define CSV Columns Header
    const csvHeaders = [
      'Student Name',
      'Email',
      'Phone',
      'Course',
      'Course ID',
      'Course Category',
      'Course Instructor',
      'Subscription',
      'Exam Scores',
      'Average Score (%)',
      'Status',
      'Enrolled Date',
    ];

    // Build CSV rows
    const rows = [];
    rows.push(csvHeaders.map(escapeCsvValue).join(','));

    students.forEach((student) => {
      // Find matching course details if available
      const courseKey = (student.course || '').toLowerCase().trim();
      const courseIdKey = (student.courseId || '').toLowerCase().trim();
      const matchedCourse = courseMap.get(courseIdKey) || courseMap.get(courseKey) || null;

      const courseId = matchedCourse ? matchedCourse.courseId || 'N/A' : (student.courseId || 'N/A');
      const category = matchedCourse ? matchedCourse.category || 'Homeopathy' : 'Homeopathy';
      const instructor = matchedCourse ? matchedCourse.instructor || 'N/A' : 'N/A';

      const examData = formatExamScoresData(student.attended_exams && student.attended_exams.length > 0 ? student.attended_exams : student.examScores);

      const enrolledDateFormatted = student.joinedDate
        ? new Date(student.joinedDate).toISOString().split('T')[0]
        : student.createdAt
        ? new Date(student.createdAt).toISOString().split('T')[0]
        : 'N/A';

      const rowValues = [
        student.name || 'N/A',
        student.email || 'N/A',
        student.phone || 'N/A',
        student.course || 'N/A',
        courseId,
        category,
        instructor,
        student.subscription || 'N/A',
        examData.scoresFormatted,
        examData.averagePercentage,
        student.status || 'Active',
        enrolledDateFormatted,
      ];

      rows.push(rowValues.map(escapeCsvValue).join(','));
    });

    // Add UTF-8 BOM (\uFEFF) for Excel compatibility with international characters
    const csvContent = '\uFEFF' + rows.join('\r\n');

    // Generate filename with timestamp
    const dateStamp = new Date().toISOString().split('T')[0];
    const fileName = `students_scores_export_${dateStamp}.csv`;

    // Set HTTP Response Headers for file download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', Buffer.byteLength(csvContent, 'utf8'));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export Students Scores Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export students and exam scores',
      error: error.message,
    });
  }
};

/**
 * @desc    Create a new student
 * @route   POST /api/admin/students
 * @access  Private / Admin
 */
async function createStudent(req, res) {
  try {
    const { name, email, phone, course, courseId, subscription, status, examScores } = req.body;

    if (!name || !email || !phone || !course || !subscription) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, phone, course, and subscription',
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
      });
    }

    const existingStudent = await Student.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { phone: phone.trim() }],
    });

    if (existingStudent) {
      return res.status(400).json({
        success: false,
        message: 'Student with this email or phone already exists',
      });
    }

    const newStudent = await Student.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      course: course.trim(),
      courseId: courseId ? courseId.trim() : '',
      subscription: subscription.trim(),
      status: status || 'Active',
      examScores: examScores || [],
    });

    return res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: newStudent,
    });
  } catch (error) {
    console.error('Create Student Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create student',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single student by ID
 * @route   GET /api/admin/students/:id
 * @access  Private / Admin
 */
async function getStudentById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format',
      });
    }

    const student = mongoose.connection.readyState === 1 ? await Student.findById(id).lean() : null;

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: student,
    });
  } catch (error) {
    console.error('Get Student By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch student details',
      error: error.message,
    });
  }
};

// =========================================================

module.exports = {
  exportStudentsScores,
  createStudent,
  getStudentById,
  getAdminStudents,
  getAdminStudentById,
  getAdminStudentResults,
  updateAdminStudent,
  updateStudent: updateAdminStudent,
  deleteAdminStudent,
  deleteStudent: deleteAdminStudent,
};
