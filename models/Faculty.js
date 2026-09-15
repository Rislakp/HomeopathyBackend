const mongoose = require('mongoose');

const facultySchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please provide faculty full name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide faculty email'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    department: {
      type: String,
      required: [true, 'Please provide department name'],
      trim: true,
    },
    role: {
      type: String,
      required: [true, 'Please provide faculty role or designation'],
      trim: true,
    },
    qualification: {
      type: String,
      required: [true, 'Please provide faculty qualification'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    experience: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for high-performance searching
facultySchema.index({ fullName: 'text', department: 'text', role: 'text', qualification: 'text' });
facultySchema.index({ status: 1, department: 1 });

module.exports = mongoose.model('Faculty', facultySchema);
