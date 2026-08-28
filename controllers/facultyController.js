const mongoose = require('mongoose');
const Faculty = require('../models/Faculty');

/**
 * Format faculty document to include standard API response fields (id, _id, aliases)
 */
const formatFacultyResponse = (facultyDoc) => {
  if (!facultyDoc) return null;
  const doc = facultyDoc.toObject ? facultyDoc.toObject() : facultyDoc;
  const idStr = doc._id ? doc._id.toString() : (doc.id ? doc.id.toString() : '');
  const imageVal = doc.profileImage || doc.avatar || doc.avatarUrl || doc.image || '';
  return {
    id: idStr,
    _id: idStr,
    fullName: doc.fullName || doc.name || '',
    name: doc.fullName || doc.name || '',
    email: doc.email || '',
    phoneNumber: doc.phoneNumber || doc.phone || doc.contactNumber || '',
    phone: doc.phoneNumber || doc.phone || doc.contactNumber || '',
    contactNumber: doc.phoneNumber || doc.phone || doc.contactNumber || '',
    department: doc.department || doc.dept || '',
    role: doc.role || doc.designation || '',
    status: doc.status || 'Active',
    qualification: doc.qualification || doc.degree || '',
    profileImage: imageVal,
    avatar: imageVal,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/**
 * @desc    Create a new Faculty member
 * @route   POST /api/admin/faculty
 * @access  Private (Admin only)
 */
const createFaculty = async (req, res) => {
  try {
    // Parse body if it comes as JSON string or handle undefined req.body safely
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // preserve original body string
      }
    }
    body = body || {};

    const {
      fullName,
      email,
      phoneNumber,
      department,
      role,
      status,
      qualification,
    } = body;

    // Destructure required fields with fallback to common alias names
    const finalFullName = (fullName || body.name || body.fullname || '').toString().trim();
    const finalEmail = (email || '').toString().trim();
    const finalPhoneNumber = (phoneNumber || body.phone || body.phonenumber || body.mobile || body.contactNumber || '').toString().trim();
    const finalDepartment = (department || body.dept || '').toString().trim();
    const finalRole = (role || body.designation || '').toString().trim();
    const finalStatus = (status || body.status || 'Active').toString().trim();
    const finalQualification = (qualification || body.qualifications || body.degree || '').toString().trim();

    // Validate required fields
    if (
      !finalFullName ||
      !finalEmail ||
      !finalPhoneNumber ||
      !finalDepartment ||
      !finalRole ||
      !finalQualification
    ) {
      const missingFields = [];
      if (!finalFullName) missingFields.push('fullName');
      if (!finalEmail) missingFields.push('email');
      if (!finalPhoneNumber) missingFields.push('phoneNumber');
      if (!finalDepartment) missingFields.push('department');
      if (!finalRole) missingFields.push('role');
      if (!finalQualification) missingFields.push('qualification');

      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: fullName, email, phoneNumber, department, role, qualification.',
        missingFields,
        receivedKeys: Object.keys(body),
      });
    }

    // Check if email already exists
    const normalizedEmail = finalEmail.toLowerCase();
    const existingFaculty = await Faculty.findOne({ email: normalizedEmail });
    if (existingFaculty) {
      return res.status(400).json({
        success: false,
        message: 'Faculty with this email already exists.',
      });
    }

    const imageVal = (body.profileImage || body.avatar || body.avatarUrl || body.image || '').toString();

    // Create new faculty member
    const faculty = new Faculty({
      fullName: finalFullName,
      email: normalizedEmail,
      phoneNumber: finalPhoneNumber,
      department: finalDepartment,
      role: finalRole,
      status: finalStatus || 'Active',
      qualification: finalQualification,
      profileImage: imageVal,
      avatar: imageVal,
    });

    const savedFaculty = await faculty.save();

    return res.status(201).json({
      success: true,
      message: 'Faculty member created successfully.',
      data: formatFacultyResponse(savedFaculty),
    });
  } catch (error) {
    console.error('Error creating faculty member:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((val) => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Faculty with this email already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error while creating faculty member.',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all Faculty members (with search, filter, and pagination)
 * @route   GET /api/admin/faculty
 * @access  Private (Admin only)
 */
const getAllFaculty = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const { search, department, status } = req.query;
    const filter = {};

    // Department filter
    if (department && department.trim() !== '') {
      filter.department = { $regex: new RegExp(`^${department.trim()}$`, 'i') };
    }

    // Status filter
    if (status && status.trim() !== '') {
      filter.status = status.trim();
    }

    // Search filter across name, email, department, role, or qualification
    if (search && search.trim() !== '') {
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
    const facultyMembers = await Faculty.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const pages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      message: 'Faculty members fetched successfully.',
      count: facultyMembers.length,
      total,
      page,
      pages,
      pagination: {
        total,
        page,
        limit,
        total_pages: pages,
        has_next: page < pages,
        has_prev: page > 1,
      },
      data: facultyMembers.map(formatFacultyResponse),
    });
  } catch (error) {
    console.error('Error fetching faculty members:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching faculty members.',
      error: error.message,
    });
  }
};

/**
 * @desc    Get a single Faculty member by ID
 * @route   GET /api/admin/faculty/:id
 * @access  Private (Admin only)
 */
const getFacultyById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Faculty ID format.',
      });
    }

    const faculty = await Faculty.findById(id);
    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Faculty member fetched successfully.',
      data: formatFacultyResponse(faculty),
    });
  } catch (error) {
    console.error('Error fetching single faculty member:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching faculty member.',
      error: error.message,
    });
  }
};

/**
 * @desc    Update a Faculty member by ID
 * @route   PUT /api/admin/faculty/:id
 * @access  Private (Admin only)
 */
const updateFaculty = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Faculty ID format.',
      });
    }

    const faculty = await Faculty.findById(id);
    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found.',
      });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // preserve original body string
      }
    }
    body = body || {};

    const {
      fullName,
      email,
      phoneNumber,
      department,
      role,
      status,
      qualification,
    } = body;

    const newEmail = email !== undefined ? email : body.email;
    const newFullName = fullName !== undefined ? fullName : (body.name !== undefined ? body.name : body.fullname);
    const newPhoneNumber = phoneNumber !== undefined ? phoneNumber : (body.phone !== undefined ? body.phone : (body.phonenumber !== undefined ? body.phonenumber : (body.mobile !== undefined ? body.mobile : body.contactNumber)));
    const newDepartment = department !== undefined ? department : body.dept;
    const newRole = role !== undefined ? role : body.designation;
    const newStatus = status !== undefined ? status : body.status;
    const newQualification = qualification !== undefined ? qualification : (body.qualifications !== undefined ? body.qualifications : body.degree);

    // Check unique email if email is being updated
    if (newEmail && newEmail.toString().toLowerCase().trim() !== faculty.email) {
      const normalizedEmail = newEmail.toString().toLowerCase().trim();
      const existingFaculty = await Faculty.findOne({
        email: normalizedEmail,
        _id: { $ne: id },
      });
      if (existingFaculty) {
        return res.status(400).json({
          success: false,
          message: 'Faculty with this email already exists.',
        });
      }
      faculty.email = normalizedEmail;
    }

    const newImage = body.profileImage !== undefined ? body.profileImage : (body.avatar !== undefined ? body.avatar : (body.avatarUrl !== undefined ? body.avatarUrl : body.image));

    if (newFullName !== undefined && newFullName !== null) faculty.fullName = newFullName.toString().trim();
    if (newPhoneNumber !== undefined && newPhoneNumber !== null) faculty.phoneNumber = newPhoneNumber.toString().trim();
    if (newDepartment !== undefined && newDepartment !== null) faculty.department = newDepartment.toString().trim();
    if (newRole !== undefined && newRole !== null) faculty.role = newRole.toString().trim();
    if (newStatus !== undefined && newStatus !== null) faculty.status = newStatus.toString().trim();
    if (newQualification !== undefined && newQualification !== null) faculty.qualification = newQualification.toString().trim();
    if (newImage !== undefined && newImage !== null) {
      faculty.profileImage = newImage.toString();
      faculty.avatar = newImage.toString();
    }

    const updatedFaculty = await faculty.save();

    return res.status(200).json({
      success: true,
      message: 'Faculty member updated successfully.',
      data: formatFacultyResponse(updatedFaculty),
    });
  } catch (error) {
    console.error('Error updating faculty member:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((val) => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Faculty with this email already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error while updating faculty member.',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete a Faculty member by ID
 * @route   DELETE /api/admin/faculty/:id
 * @access  Private (Admin only)
 */
const deleteFaculty = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Faculty ID format.',
      });
    }

    const faculty = await Faculty.findByIdAndDelete(id);
    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Faculty member deleted successfully.',
    });
  } catch (error) {
    console.error('Error deleting faculty member:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting faculty member.',
      error: error.message,
    });
  }
};

module.exports = {
  createFaculty,
  getAllFaculty,
  getFacultyById,
  updateFaculty,
  deleteFaculty,
};
