const Faculty = require('../models/Faculty');

/**
 * Format a faculty document to ensure all ID and image fields are normalized
 * across both Landing Page and Student Portal client expectations.
 */
const formatFacultyDoc = (doc) => {
  if (!doc) return null;
  const idStr = doc._id ? doc._id.toString() : (doc.id ? doc.id.toString() : '');
  const imageVal = doc.avatarUrl || doc.profileImage || doc.avatar || doc.image || '';
  return {
    ...doc,
    _id: idStr,
    id: idStr,
    fullName: doc.fullName || doc.name || '',
    email: doc.email || '',
    department: doc.department || '',
    role: doc.role || doc.designation || 'Faculty',
    qualification: doc.qualification || '',
    phone: doc.phone || '',
    bio: doc.bio || '',
    avatarUrl: imageVal,
    profileImage: imageVal,
    avatar: imageVal,
    experience: doc.experience || '',
    status: doc.status || 'Active',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/**
 * @desc    Get active faculty members for student portal / public landing page with search, department filter, and optional pagination
 * @route   GET /api/student/faculty or GET /api/v1/student/faculty
 * @access  Public / Student
 */
exports.getStudentFaculty = async (req, res) => {
  try {
    const { search, department, all, paginate, pagination } = req.query;

    // Only fetch active faculty for students/public (case-insensitive for safety)
    const filter = {
      status: { $regex: /^active$/i },
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

    // Total count of matching faculty
    const total = await Faculty.countDocuments(filter);

    // Determine pagination:
    // 1. Explicit all requested (all=true, limit=all, limit=0, limit=-1) -> return all records
    // 2. Default call (no limit or legacy landing default limit=10 without explicit paginate flag) -> return all records
    // 3. Explicit pagination (paginate=true, pagination=true, page > 1, or custom numeric limit != 10) -> paginate
    const rawLimit = req.query.limit;
    const rawPage = req.query.page;
    const parsedPage = parseInt(rawPage, 10);
    const parsedLimit = parseInt(rawLimit, 10);

    const isAllRequested =
      all === 'true' ||
      all === '1' ||
      rawLimit === 'all' ||
      rawLimit === '0' ||
      rawLimit === '-1';

    const isExplicitPagination =
      paginate === 'true' ||
      pagination === 'true' ||
      (Number.isInteger(parsedPage) && parsedPage > 1);

    const isCustomLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit !== 10;

    const shouldPaginate = !isAllRequested && (isExplicitPagination || isCustomLimit);

    let page = 1;
    let limit = total;
    let skip = 0;
    let pages = 1;
    let totalPages = 1;
    let hasNextPage = false;
    let hasPrevPage = false;

    let query = Faculty.find(filter)
      .select('_id fullName email department role qualification phone bio avatarUrl experience createdAt status')
      .sort({ fullName: 1 })
      .lean();

    if (shouldPaginate) {
      page = Math.max(1, parsedPage || 1);
      limit = Math.min(1000, Math.max(1, parsedLimit || 10));
      skip = (page - 1) * limit;
      pages = total > 0 ? Math.ceil(total / limit) : 1;
      totalPages = pages;
      hasNextPage = page < pages;
      hasPrevPage = page > 1;

      query = query.skip(skip).limit(limit);
    } else {
      limit = total;
      pages = 1;
      totalPages = 1;
      hasNextPage = false;
      hasPrevPage = false;
    }

    const rawFacultyList = await query;
    const facultyList = rawFacultyList.map(formatFacultyDoc);

    return res.status(200).json({
      success: true,
      count: facultyList.length,
      total,
      page,
      pages,
      totalPages,
      limit,
      hasNextPage,
      hasPrevPage,
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

    const faculty = await Faculty.findOne({ _id: id, status: { $regex: /^active$/i } })
      .select('_id fullName email department role qualification phone bio avatarUrl experience createdAt status')
      .lean();

    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: formatFacultyDoc(faculty),
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
 * @route   GET /api/faculty or GET /api/admin/faculty
 * @access  Admin
 */
exports.getAllFacultyAdmin = async (req, res) => {
  try {
    const { search, department, status, all, paginate, pagination } = req.query;
    const filter = {};

    if (status && status.toLowerCase() !== 'all') {
      filter.status = { $regex: new RegExp(`^${status.trim()}$`, 'i') };
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

    const rawLimit = req.query.limit;
    const rawPage = req.query.page;
    const parsedPage = parseInt(rawPage, 10);
    const parsedLimit = parseInt(rawLimit, 10);

    const isAllRequested =
      all === 'true' ||
      all === '1' ||
      rawLimit === 'all' ||
      rawLimit === '0' ||
      rawLimit === '-1';

    const isExplicitPagination =
      paginate === 'true' ||
      pagination === 'true' ||
      (Number.isInteger(parsedPage) && parsedPage > 1);

    const isCustomLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit !== 20;

    const shouldPaginate = !isAllRequested && (isExplicitPagination || isCustomLimit);

    let page = 1;
    let limit = total;
    let skip = 0;
    let pages = 1;
    let totalPages = 1;
    let hasNextPage = false;
    let hasPrevPage = false;

    let query = Faculty.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    if (shouldPaginate) {
      page = Math.max(1, parsedPage || 1);
      limit = Math.min(1000, Math.max(1, parsedLimit || 20));
      skip = (page - 1) * limit;
      pages = total > 0 ? Math.ceil(total / limit) : 1;
      totalPages = pages;
      hasNextPage = page < pages;
      hasPrevPage = page > 1;

      query = query.skip(skip).limit(limit);
    } else {
      limit = total;
      pages = 1;
      totalPages = 1;
      hasNextPage = false;
      hasPrevPage = false;
    }

    const rawFacultyList = await query;
    const facultyList = rawFacultyList.map(formatFacultyDoc);

    return res.status(200).json({
      success: true,
      count: facultyList.length,
      total,
      page,
      pages,
      totalPages,
      limit,
      hasNextPage,
      hasPrevPage,
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
 * @route   POST /api/faculty or POST /api/admin/faculty
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
      data: formatFacultyDoc(faculty.toObject()),
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
 * @route   PUT /api/faculty/:id or PUT /api/admin/faculty/:id
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
      data: formatFacultyDoc(updatedFaculty.toObject()),
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
 * @route   DELETE /api/faculty/:id or DELETE /api/admin/faculty/:id
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
