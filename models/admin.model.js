const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  resetPasswordToken: String,
  resetPasswordExpire: Date,

  role: {
    type: String,
    enum: ['ADMIN', 'SUPERADMIN'],
    default: 'ADMIN'
  },

  isActive: {
    type: Boolean,
    default: true
  },

  tokenVersion: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Admin', adminSchema);