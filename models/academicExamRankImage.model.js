const mongoose = require('mongoose');

/**
 * AcademicExamRankImage Schema
 * Stores dedicated rank banner/image metadata for Academic Exams (Test History -> Rank view).
 * Enforces one rank image per Academic exam via unique examId index.
 */
const academicExamRankImageSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: [true, 'Academic examId is required'],
      unique: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'imageUrl is required'],
      trim: true,
    },
    publicId: {
      type: String,
      default: '',
      trim: true,
    },
    originalName: {
      type: String,
      default: '',
      trim: true,
    },
    altText: {
      type: String,
      default: 'Top Ranked Students',
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

// MongoDB unique index constraint: strictly one rank image per Academic exam
academicExamRankImageSchema.index({ examId: 1 }, { unique: true });

module.exports =
  mongoose.models.AcademicExamRankImage ||
  mongoose.model('AcademicExamRankImage', academicExamRankImageSchema);
