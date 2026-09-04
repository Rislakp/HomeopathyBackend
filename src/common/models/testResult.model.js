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
  correctOption: {
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
  unansweredQuestions: {
    type: Number,
    required: true,
    default: 0
  },
  positiveMarks: {
    type: Number,
    required: true,
    default: 0
  },
  negativeMarks: {
    type: Number,
    required: true,
    default: 0
  },
  maximumScore: {
    type: Number,
    required: true,
    default: 0
  },
  percentage: {
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

// Indexes for aggregation and performance optimization
testResultSchema.index({ studentId: 1, createdAt: -1 });
testResultSchema.index({ examId: 1 });
testResultSchema.index({ studentId: 1, examId: 1 });

module.exports = mongoose.models.TestResult || mongoose.model('TestResult', testResultSchema);
