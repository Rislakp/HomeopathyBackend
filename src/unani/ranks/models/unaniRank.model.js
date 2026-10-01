const mongoose = require('mongoose');

const unaniRankSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Rank holder name is required'],
      trim: true,
    },
    examName: {
      type: String,
      trim: true,
      default: '',
    },
    rankLabel: {
      type: String,
      trim: true,
      default: '',
    },
    year: {
      type: Number,
      default: () => new Date().getFullYear(),
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    score: {
      type: Number,
      default: null,
    },
    percentage: {
      type: Number,
      default: null,
    },
    profileImage: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
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
    collection: 'unaniranks',
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
unaniRankSchema.index({ courseId: 1, isDeleted: 1, isActive: 1, displayOrder: 1, createdAt: -1 });
unaniRankSchema.index({ displayOrder: 1, createdAt: -1 });

module.exports =
  mongoose.models.UnaniRank ||
  mongoose.model('UnaniRank', unaniRankSchema);
