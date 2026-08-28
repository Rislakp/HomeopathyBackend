const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: true,
    trim: true
  },
  passage: {
    type: String,
    trim: true,
    required: false,
    default: null
  },
  imageUrl: {
    type: String,
    trim: true,
    required: false,
    default: null
  },
  tableData: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: null
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
}, { _id: true });

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
  negativeMark: {
    type: Number,
    default: 0,
    min: [0, 'Negative mark cannot be negative'],
    required: false
  },
  negativeMarkPenalty: {
    type: Number,
    default: 0,
    min: [0, 'Negative mark penalty cannot be negative'],
    required: false
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
