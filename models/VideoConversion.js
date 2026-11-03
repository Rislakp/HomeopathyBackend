const mongoose = require('mongoose');

const videoConversionSchema = new mongoose.Schema(
  {
    originalS3Key: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    originalContentType: {
      type: String,
      trim: true,
      default: 'video/mp4',
    },
    m4vS3Key: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['none', 'pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    error: {
      type: String,
      trim: true,
      default: '',
    },
    duration: {
      type: Number,
      default: 0,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

videoConversionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('VideoConversion', videoConversionSchema);

