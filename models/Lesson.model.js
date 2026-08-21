const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema({
  courseId: {
    type: String,
    ref: 'Course',
    required: true
  },
  lessonTitle: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 150
  },
  uploadFileOrLink: {
    type: String,
    required: true,
    trim: true
  },
  lessonType: {
    type: String,
    required: true,
    enum: ['video', 'pdf', 'link', 'document', 'audio', 'Live Class']
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Lesson', lessonSchema);
