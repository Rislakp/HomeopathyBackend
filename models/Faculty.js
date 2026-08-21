const mongoose = require('mongoose');

const facultySchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['Active', 'On Leave', 'Inactive'],
        message: '{VALUE} is not a valid status',
      },
      default: 'Active',
    },
    qualification: {
      type: String,
      required: [true, 'Qualification is required'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add text index for search support across key string fields
facultySchema.index({
  fullName: 'text',
  email: 'text',
  department: 'text',
  role: 'text',
  qualification: 'text',
});

module.exports = mongoose.models.Faculty || mongoose.model('Faculty', facultySchema);
