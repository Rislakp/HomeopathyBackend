const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  selectedOption: {
    type: String,
    enum: ['A', 'B', 'C', 'D', null, ''],
    default: null
  },
  isCorrect: {
    type: Boolean,
    required: true,
    default: false
  }
}, { _id: false });

const testResultSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  score: {
    type: Number,
    required: true,
    default: 0
  },
  totalMarks: {
    type: Number,
    required: true,
    default: 0
  },
  totalAttempted: {
    type: Number,
    required: true,
    default: 0
  },
  totalCorrect: {
    type: Number,
    required: true,
    default: 0
  },
  totalWrong: {
    type: Number,
    required: true,
    default: 0
  },
  status: {
    type: String,
    enum: ['Completed', 'In Progress', 'Attempted'],
    default: 'Completed'
  },
  answers: [answerSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('TestResult', testResultSchema);
