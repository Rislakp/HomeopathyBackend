const mongoose = require('mongoose');

const lessonProgressSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true,
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true,
  },
  moduleId: {
    type: String,
    required: true,
  },
  lessonId: {
    type: String,
    required: true,
  },
  videoWatched: {
    type: Boolean,
    default: false,
  },
  videoProgress: {
    type: Number,
    default: 0,
  },
  videoDuration: {
    type: Number,
    default: 0,
  },
  watchedPercent: {
    type: Number,
    default: 0,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  pdfDownloaded: {
    type: Boolean,
    default: false,
  },
  pdfDownloadedAt: {
    type: Date,
    default: null,
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

lessonProgressSchema.index({ studentId: 1, courseId: 1, lessonId: 1 }, { unique: true });

module.exports = mongoose.model('LessonProgress', lessonProgressSchema);
