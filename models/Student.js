const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  dateOfBirth: {
    type: String,
    trim: true
  },
  contactNumber: {
    type: String,
    trim: true
  },
  qualification: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  course: {
    type: String,
    trim: true,
    default: 'General'
  },
  subscription: {
    type: String,
    trim: true,
    default: 'Free'
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Trial', 'Expired'],
    default: 'Active'
  },
  joinedDate: {
    type: Date,
    default: Date.now
  },
  avatar: {
    type: String,
    trim: true,
    default: ''
  },
  profileImage: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    transform: function(doc, ret) {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for performance optimization (email already has unique index)
studentSchema.index({ userId: 1 });
studentSchema.index({ status: 1 });
studentSchema.index({ course: 1 });
studentSchema.index({ name: 1 });
studentSchema.index({ phone: 1 });
studentSchema.index({ contactNumber: 1 });
studentSchema.index({ createdAt: -1 });
studentSchema.index({ status: 1, course: 1, createdAt: -1 });

module.exports = mongoose.models.Student || mongoose.model('Student', studentSchema);
