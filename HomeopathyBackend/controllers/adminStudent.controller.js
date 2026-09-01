const mongoose = require('mongoose');
const Student = require('../models/Student');
const Course = require('../models/Course');

/**
 * Utility helper to escape and format a value for RFC 4180 compliant CSV
 * Handles commas, double quotes, line breaks, null/undefined, and dates
 */
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

/**
 * Format exam scores array into readable string and calculate average
 */
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
    const title = exam.examTitle || 'Exam';
    const score = exam.score !== undefined ? exam.score : 0;
    const maxScore = exam.maxScore || 100;
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const grade = exam.grade ? ` [${exam.grade}]` : '';

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
exports.exportStudentsScores = async (req, res) => {
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

    // Fetch students
    const students = mongoose.connection.readyState === 1
      ? await Student.find(filter).sort({ joinedDate: -1, createdAt: -1 }).lean()
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

      const examData = formatExamScoresData(student.examScores);

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
 * @desc    Get paginated students list with exam scores and course details (Admin JSON API)
 * @route   GET /api/admin/students
 * @access  Private / Admin
 */
exports.getAdminStudents = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const { status, course, search } = req.query;

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

    const total = mongoose.connection.readyState === 1 ? await Student.countDocuments(filter) : 0;
    const students = mongoose.connection.readyState === 1
      ? await Student.find(filter)
          .sort({ joinedDate: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
      : [];

    const pages = total > 0 ? Math.ceil(total / limit) : 1;

    return res.status(200).json({
      success: true,
      count: students.length,
      total,
      page,
      pages,
      data: students,
    });
  } catch (error) {
    console.error('Get Admin Students Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch students list',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single student by ID
 * @route   GET /api/admin/students/:id
 * @access  Private / Admin
 */
exports.getStudentById = async (req, res) => {
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

/**
 * @desc    Create a new student
 * @route   POST /api/admin/students
 * @access  Private / Admin
 */
exports.createStudent = async (req, res) => {
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
 * @desc    Update a student
 * @route   PUT /api/admin/students/:id
 * @access  Private / Admin
 */
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format',
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
      });
    }

    const updatedStudent = await Student.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Student updated successfully',
      data: updatedStudent,
    });
  } catch (error) {
    console.error('Update Student Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update student',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete a student
 * @route   DELETE /api/admin/students/:id
 * @access  Private / Admin
 */
exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format',
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
      });
    }

    const deletedStudent = await Student.findByIdAndDelete(id);

    if (!deletedStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Student deleted successfully',
      data: deletedStudent,
    });
  } catch (error) {
    console.error('Delete Student Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete student',
      error: error.message,
    });
  }
};
