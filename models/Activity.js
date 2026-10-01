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
      required: false,
      default: 'general',
      trim: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      default: null,
    },
    actor: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      default: null,
    },
    // Optional learning-event context. Keeping these fields on the common
    // activity record lets the existing recent-activity endpoint return the
    // latest student actions without a second, unsorted data source.
    action: { type: String, trim: true, default: '' },
    courseId: { type: mongoose.Schema.Types.Mixed, default: null },
    moduleId: { type: String, trim: true, default: '' },
    lessonId: { type: String, trim: true, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
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
