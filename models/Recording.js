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
    duration: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'idle', 'recording', 'paused', 'stopped', 'recorded', 'Completed', 'Pending', 'Recording'],
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

module.exports = mongoose.model('Recording', recordingSchema);
