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
  },
  duration: {
    type: String,
    default: '',
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: false,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('DemoVideo', demoVideoSchema);
