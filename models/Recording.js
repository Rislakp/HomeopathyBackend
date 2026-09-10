const mongoose = require('mongoose');

const recordingSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: [true, 'Course reference is required'],
  },
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Module reference is required'],
  },
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Lesson reference is required'],
  },
  liveClassUrl: {
    type: String,
    required: [true, 'Live class URL is required'],
    trim: true,
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
    enum: ['Pending', 'Recording', 'Completed'],
    default: 'Pending',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Recording', recordingSchema);
