const Faculty = require('../models/Faculty');

/**
 * @desc    Get active faculty members for student portal with search, department filter, and pagination
 * @route   GET /api/student/faculty or GET /api/v1/student/faculty
 * @access  Public / Student
 */
exports.getStudentFaculty = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const { search, department } = req.query;

    // Only fetch active faculty for students
    const filter = {
      status: 'Active',
    };

    // Filter by specific department if provided
    if (department && department.trim() && department.toLowerCase() !== 'all') {
      filter.department = { $regex: new RegExp(`^${department.trim()}$`, 'i') };
    }

    // Search by full name, email, department, role, or qualification
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
        { role: searchRegex },
        { qualification: searchRegex },
      ];
    }

    // Total count for pagination
    const total = await Faculty.countDocuments(filter);

    // Fetch faculty list
    const facultyList = await Faculty.find(filter)
      .select('_id fullName email department role qualification phone bio avatarUrl experience createdAt')
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const pages = total > 0 ? Math.ceil(total / limit) : 1;

    return res.status(200).json({
      success: true,
      count: facultyList.length,
      total,
      page,
      pages,
      data: facultyList,
    });
  } catch (error) {
    console.error('Get Student Faculty Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch faculty members',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single faculty details by ID for student portal
 * @route   GET /api/student/faculty/:id
 * @access  Public / Student
 */
exports.getStudentFacultyById = async (req, res) => {
  try {
    const { id } = req.params;

    const faculty = await Faculty.findOne({ _id: id, status: 'Active' })
      .select('_id fullName email department role qualification phone bio avatarUrl experience createdAt')
      .lean();

    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: faculty,
    });
  } catch (error) {
    console.error('Get Student Faculty By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch faculty details',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all faculty members (Admin view - includes active & inactive)
 * @route   GET /api/faculty
 * @access  Admin
 */
exports.getAllFacultyAdmin = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, department, status } = req.query;
    const filter = {};

    if (status && status.toLowerCase() !== 'all') {
      filter.status = status;
    }

    if (department && department.toLowerCase() !== 'all') {
      filter.department = { $regex: new RegExp(`^${department.trim()}$`, 'i') };
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
        { role: searchRegex },
        { qualification: searchRegex },
      ];
    }

    const total = await Faculty.countDocuments(filter);
    const facultyList = await Faculty.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const pages = total > 0 ? Math.ceil(total / limit) : 1;

    return res.status(200).json({
      success: true,
      count: facultyList.length,
      total,
      page,
      pages,
      data: facultyList,
    });
  } catch (error) {
    console.error('Admin Get All Faculty Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch faculty members',
      error: error.message,
    });
  }
};

/**
 * @desc    Create new faculty member
 * @route   POST /api/faculty
 * @access  Admin
 */
exports.createFaculty = async (req, res) => {
  try {
    const {
      fullName,
      email,
      department,
      role,
      qualification,
      status,
      phone,
      bio,
      avatarUrl,
      experience,
    } = req.body;

    // Check if email already exists
    const existingFaculty = await Faculty.findOne({ email: email ? email.toLowerCase().trim() : '' });
    if (existingFaculty) {
      return res.status(400).json({
        success: false,
        message: 'A faculty member with this email address already exists',
      });
    }

    const faculty = new Faculty({
      fullName,
      email,
      department,
      role,
      qualification,
      status: status || 'Active',
      phone,
      bio,
      avatarUrl,
      experience,
    });

    await faculty.save();

    return res.status(201).json({
      success: true,
      message: 'Faculty member created successfully',
      data: faculty,
    });
  } catch (error) {
    console.error('Create Faculty Error:', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create faculty member',
      error: error.message,
    });
  }
};

/**
 * @desc    Update faculty member by ID
 * @route   PUT /api/faculty/:id
 * @access  Admin
 */
exports.updateFaculty = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const updatedFaculty = await Faculty.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedFaculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Faculty member updated successfully',
      data: updatedFaculty,
    });
  } catch (error) {
    console.error('Update Faculty Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update faculty member',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete faculty member by ID
 * @route   DELETE /api/faculty/:id
 * @access  Admin
 */
exports.deleteFaculty = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedFaculty = await Faculty.findByIdAndDelete(id);

    if (!deletedFaculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Faculty member deleted successfully',
    });
  } catch (error) {
    console.error('Delete Faculty Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete faculty member',
      error: error.message,
    });
  }
};
