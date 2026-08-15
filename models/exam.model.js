const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: true,
    trim: true
  },
  options: {
    A: {
      type: String,
      required: true,
      trim: true
    },
    B: {
      type: String,
      required: true,
      trim: true
    },
    C: {
      type: String,
      required: true,
      trim: true
    },
    D: {
      type: String,
      required: true,
      trim: true
    }
  },
  correctOption: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    required: true
  }
}, { _id: false });

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  marksPerQuestion: {
    type: Number,
    required: true
  },
  negativeMarkPenalty: {
    type: Number,
    required: true,
    default: 1
  },
  durationMinutes: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  questions: [questionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.models.Exam || mongoose.model('Exam', examSchema);
