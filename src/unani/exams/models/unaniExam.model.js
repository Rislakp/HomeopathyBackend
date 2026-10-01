const mongoose = require('mongoose');

const unaniQuestionSchema = new mongoose.Schema(
  {
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
    },
    passage: {
      type: String,
      trim: true,
      default: null,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    tableData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    options: {
      A: { type: String, required: true, trim: true },
      B: { type: String, required: true, trim: true },
      C: { type: String, required: true, trim: true },
      D: { type: String, required: true, trim: true },
    },
    correctOption: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
      required: [true, 'Correct option (A, B, C, or D) is required'],
    },
    explanation: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const unaniExamSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Exam title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    examType: {
      type: String,
      enum: ['grand_mock_test'],
      default: 'grand_mock_test',
      required: true,
      trim: true,
    },
    courseId: {
      type: String,
      enum: ['unani'],
      default: 'unani',
      required: true,
      trim: true,
    },
    marksPerQuestion: {
      type: Number,
      required: [true, 'Marks per question is required'],
      min: [0, 'Marks per question must be positive'],
    },
    negativeMark: {
      type: Number,
      default: 0,
      min: [0, 'Negative mark cannot be negative'],
    },
    negativeMarkPenalty: {
      type: Number,
      default: 0,
      min: [0, 'Negative mark penalty cannot be negative'],
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      min: [1, 'Duration must be at least 1 minute'],
    },
    totalQuestions: {
      type: Number,
      required: [true, 'Total questions count is required'],
      default: 0,
    },
    questions: [unaniQuestionSchema],
    status: {
      type: String,
      enum: ['Published', 'Draft', 'Archived'],
      default: 'Published',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports =
  mongoose.models.UnaniExam || mongoose.model('UnaniExam', unaniExamSchema);
