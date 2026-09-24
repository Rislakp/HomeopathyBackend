const mongoose = require('mongoose');

const unaniAnswerSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    selectedOption: {
      type: String,
      enum: ['A', 'B', 'C', 'D', null, ''],
      default: null,
    },
    correctOption: {
      type: String,
      enum: ['A', 'B', 'C', 'D', null, ''],
      default: null,
    },
    isCorrect: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: false }
);

const unaniExamResultSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UnaniExam',
      required: true,
    },
    courseId: {
      type: String,
      enum: ['unani'],
      default: 'unani',
      required: true,
    },
    examType: {
      type: String,
      enum: ['grand_mock_test'],
      default: 'grand_mock_test',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    totalMarks: {
      type: Number,
      required: true,
      default: 0,
    },
    percentage: {
      type: Number,
      required: true,
      default: 0,
    },
    correctAnswers: {
      type: Number,
      required: true,
      default: 0,
    },
    wrongAnswers: {
      type: Number,
      required: true,
      default: 0,
    },
    unanswered: {
      type: Number,
      required: true,
      default: 0,
    },
    answers: [unaniAnswerSchema],
    status: {
      type: String,
      enum: ['Completed', 'In Progress', 'Attempted'],
      default: 'Completed',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        // Aliases for compatibility
        ret.totalCorrect = ret.correctAnswers;
        ret.totalWrong = ret.wrongAnswers;
        ret.unansweredQuestions = ret.unanswered;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret.totalCorrect = ret.correctAnswers;
        ret.totalWrong = ret.wrongAnswers;
        ret.unansweredQuestions = ret.unanswered;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

unaniExamResultSchema.index({ studentId: 1, createdAt: -1 });
unaniExamResultSchema.index({ examId: 1, score: -1 });
unaniExamResultSchema.index({ studentId: 1, examId: 1 });

module.exports =
  mongoose.models.UnaniExamResult ||
  mongoose.model('UnaniExamResult', unaniExamResultSchema);
