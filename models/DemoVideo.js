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
}, {
  timestamps: true,
});

module.exports = mongoose.model('DemoVideo', demoVideoSchema);


