const mongoose = require('mongoose');

const demoVideoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Demo video title is required'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  videoUrl: {
    type: String,
    required: [true, 'Video URL is required'],
    trim: true,
  },
  thumbnailUrl: {
    type: String,
    trim: true,
    default: '',
  },
  thumbnail: {
    type: String,
    trim: true,
    default: '',
  },
  duration: {
    type: String,
    trim: true,
    default: '',
  },
  courseId: {
    type: String,
    required: [true, 'courseId is required'],
    index: true,
    trim: true,
  },
  courseRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    default: null,
  },
  storageProvider: {
    type: String,
    trim: true,
    default: '',
  },
  s3Key: {
    type: String,
    trim: true,
    default: '',
  },
  originalVideoUrl: {
    type: String,
    trim: true,
    default: '',
  },
  hlsMasterUrl: {
    type: String,
    trim: true,
    default: '',
  },
  hlsOutputPrefix: {
    type: String,
    trim: true,
    default: '',
  },
  mediaConvertJobId: {
    type: String,
    trim: true,
    default: '',
  },
  hlsConversionStatus: {
    type: String,
    enum: ['none', 'pending', 'processing', 'completed', 'failed', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'none',
  },
  hlsConversionError: {
    type: String,
    trim: true,
    default: '',
  },
  hlsConvertedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('DemoVideo', demoVideoSchema);


