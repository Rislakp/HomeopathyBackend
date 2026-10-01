const Faculty = require('../models/Faculty');
const memoryCache = require('../utils/cache');

/**
 * Format a faculty document to ensure all ID and image fields are normalized
 * across both Landing Page and Student Portal client expectations.
 */
const formatFacultyDoc = (doc, options = {}) => {
  if (!doc) return null;
  const idStr = doc._id ? doc._id.toString() : (doc.id ? doc.id.toString() : '');
  let imageVal = doc.avatarUrl || doc.profileImage || doc.avatar || doc.image || '';

  // Never send large base64 image payloads in list APIs (Section 4 requirement)
  if (options.isList && imageVal && imageVal.length > 1024 && (imageVal.startsWith('data:image') || !imageVal.startsWith('http'))) {
    imageVal = '';
  }

  return {
    _id: idStr,
    id: idStr,
    fullName: doc.fullName || doc.name || '',
    email: doc.email || '',
    department: doc.department || '',
    role: doc.role || doc.designation || 'Faculty',
    qualification: doc.qualification || '',
    phone: doc.phone || '',
    bio: options.isList ? (doc.bio ? doc.bio.slice(0, 200) : '') : (doc.bio || ''),
    avatarUrl: imageVal,
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
    const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');

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

    const { search, department } = req.query;

    const cacheKey = `faculty_student_${page}_${limit}_${(search || '').trim()}_${(department || '').trim()}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    // Only fetch active faculty for students/public (case-insensitive for safety)
    const filter = {
      status: { $regex: /^active$/i },
    };

    // Filter by specific department if provided
    if (department && department.trim() && department.toLowerCase() !== 'all') {
      filter.department = { $regex: new RegExp(`^${department.trim()}$`, 'i') };
    }

    // Search by full name, email, department, role, or qualification in MongoDB
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
        { role: searchRegex },
        { qualification: searchRegex },
      ];
    }

    // Execute count and paginated query concurrently
    const [total, rawFacultyList] = await Promise.all([
      Faculty.countDocuments(filter),
      Faculty.find(filter)
        .select('_id fullName email department role qualification phone bio avatarUrl profileImage avatar experience status createdAt updatedAt')
        .sort({ fullName: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const facultyList = rawFacultyList.map((f) => formatFacultyDoc(f, { isList: true }));
    const pagination = buildPaginationResponse(total, page, limit);

    const responsePayload = {
      success: true,
      data: facultyList,
      pagination: pagination,
      count: facultyList.length,
      total: pagination.total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: pagination.totalPages,
      pages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
      hasPrevPage: pagination.hasPreviousPage,
    };

    memoryCache.set(cacheKey, responsePayload, 30);
    return res.status(200).json(responsePayload);
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
    const { parsePaginationParams, buildPaginationResponse } = require('../utils/pagination');

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

    const { search, department, status } = req.query;
    const cacheKey = `faculty_admin_${page}_${limit}_${(search || '').trim()}_${(department || '').trim()}_${(status || '').trim()}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const filter = {};

    if (status && status.toLowerCase() !== 'all') {
      filter.status = { $regex: new RegExp(`^${status.trim()}$`, 'i') };
    }

    if (department && department.toLowerCase() !== 'all') {
      filter.department = { $regex: new RegExp(`^${department.trim()}$`, 'i') };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
        { role: searchRegex },
        { qualification: searchRegex },
      ];
    }

    // Execute count and paginated query concurrently with projection
    const [total, rawFacultyList] = await Promise.all([
      Faculty.countDocuments(filter),
      Faculty.find(filter)
        .select('_id fullName email department role qualification phone bio avatarUrl profileImage avatar experience status createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const facultyList = rawFacultyList.map((f) => formatFacultyDoc(f, { isList: true }));
    const pagination = buildPaginationResponse(total, page, limit);

    const responsePayload = {
      success: true,
      data: facultyList,
      pagination: pagination,
      count: facultyList.length,
      total: pagination.total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: pagination.totalPages,
      pages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
      hasPrevPage: pagination.hasPreviousPage,
    };

    memoryCache.set(cacheKey, responsePayload, 30);
    return res.status(200).json(responsePayload);
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
    memoryCache.del('faculty_');

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

    memoryCache.del('faculty_');

    return res.status(200).json({
      success: true,
      message: 'Faculty member updated successfully',
      data: formatFacultyDoc(updatedFaculty.toObject()),
    });
  } catch (error) {
    console.error('Update Faculty Error:', error);
    
    if (error.code === 11000 && error.keyPattern && error.keyPattern.email) {
      return res.status(400).json({
        success: false,
        message: 'A faculty member with this email address already exists',
      });
    }

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

    memoryCache.del('faculty_');

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
