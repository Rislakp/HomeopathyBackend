const mongoose = require('mongoose');

const recordingSchema = new mongoose.Schema(
  {
    courseName: {
      type: String,
      trim: true,
      default: '',
    },
    moduleName: {
      type: String,
      trim: true,
      default: '',
    },
    lessonTitle: {
      type: String,
      trim: true,
      default: '',
    },
    streamUrl: {
      type: String,
      trim: true,
      default: '',
    },
    recordedVideoUrl: {
      type: String,
      trim: true,
      default: '',
    },
    width: {
      type: Number,
      default: 0,
    },
    height: {
      type: Number,
      default: 0,
    },
    bytes: {
      type: Number,
      default: 0,
    },
    format: {
      type: String,
      trim: true,
      default: 'mp4',
    },
    resolution: {
      type: String,
      trim: true,
      default: '',
    },
    qualityTag: {
      type: String,
      trim: true,
      default: '',
    },
    // Hierarchical / Course model references (optional)
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: false,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    liveClassUrl: {
      type: String,
      trim: true,
      default: '',
    },
    recordingFileUrl: {
      type: String,
      trim: true,
      default: '',
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
    m4vS3Key: {
      type: String,
      trim: true,
      default: '',
    },
    m4vStorageProvider: {
      type: String,
      trim: true,
      default: '',
    },
    m4vConversionStatus: {
      type: String,
      enum: ['none', 'pending', 'processing', 'completed', 'failed'],
      default: 'none',
    },
    m4vConversionError: {
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
    duration: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'idle', 'recording', 'paused', 'stopped', 'recorded', 'completed', 'Completed', 'Pending', 'Recording'],
      default: 'pending',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// MongoDB performance indexes
recordingSchema.index({ courseId: 1, createdAt: -1 });
recordingSchema.index({ status: 1, createdAt: -1 });
recordingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Recording', recordingSchema);


