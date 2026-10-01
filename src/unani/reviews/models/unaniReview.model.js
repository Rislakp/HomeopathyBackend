const mongoose = require('mongoose');

const unaniReviewSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
      default: '',
    },
    review: {
      type: String,
      required: [true, 'Review text is required'],
      trim: true,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating must be at most 5'],
      default: 5,
    },
    profileImage: {
      type: String,
      trim: true,
      default: '',
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    courseId: {
      type: String,
      default: 'unani',
      trim: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'unanireviews',
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret._id = ret.id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret._id = ret.id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// High-performance compound indexes for public list & admin list
unaniReviewSchema.index({ courseId: 1, isDeleted: 1, isActive: 1, displayOrder: 1, createdAt: -1 });
unaniReviewSchema.index({ displayOrder: 1, createdAt: -1 });

module.exports =
  mongoose.models.UnaniReview ||
  mongoose.model('UnaniReview', unaniReviewSchema);
