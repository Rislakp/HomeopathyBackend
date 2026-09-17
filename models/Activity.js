const mongoose = require('mongoose');

/**
 * Activity Schema for tracking platform logs & notifications
 */
const activitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Activity title is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Activity description is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Activity type category is required'],
      trim: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Optimize query performance for reverse chronological feed queries
activitySchema.index({ createdAt: -1 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
