const mongoose = require('mongoose');
const Faculty = require('../models/Faculty');

/**
 * @desc    Create a new Faculty member
 * @route   POST /api/admin/faculty
 * @access  Private (Admin only)
 */
const createFaculty = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      department,
      role,
      status,
      qualification,
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !phoneNumber || !department || !role || !qualification) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: fullName, email, phoneNumber, department, role, qualification.',
      });
    }

    // Check if email already exists
    const normalizedEmail = email.toLowerCase().trim();
    const existingFaculty = await Faculty.findOne({ email: normalizedEmail });
    if (existingFaculty) {
      return res.status(400).json({
        success: false,
        message: 'Faculty with this email already exists.',
      });
    }

    // Create new faculty member
    const faculty = new Faculty({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phoneNumber: phoneNumber.trim(),
      department: department.trim(),
      role: role.trim(),
      status: status || 'Active',
      qualification: qualification.trim(),
    });

    const savedFaculty = await faculty.save();

    return res.status(201).json({
      success: true,
      message: 'Faculty member created successfully.',
      data: savedFaculty,
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
      count: facultyMembers.length,
      total,
      page,
      pages,
      data: facultyMembers,
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
      data: faculty,
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

    const {
      fullName,
      email,
      phoneNumber,
      department,
      role,
      status,
      qualification,
    } = req.body;

    // Check unique email if email is being updated
    if (email && email.toLowerCase().trim() !== faculty.email) {
      const normalizedEmail = email.toLowerCase().trim();
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

    if (fullName !== undefined) faculty.fullName = fullName.trim();
    if (phoneNumber !== undefined) faculty.phoneNumber = phoneNumber.trim();
    if (department !== undefined) faculty.department = department.trim();
    if (role !== undefined) faculty.role = role.trim();
    if (status !== undefined) faculty.status = status;
    if (qualification !== undefined) faculty.qualification = qualification.trim();

    const updatedFaculty = await faculty.save();

    return res.status(200).json({
      success: true,
      message: 'Faculty member updated successfully.',
      data: updatedFaculty,
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
