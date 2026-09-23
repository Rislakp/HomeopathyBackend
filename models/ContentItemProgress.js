const mongoose = require('mongoose');

/**
 * ContentItemProgress — tracks completion of a single content item
 * (videoPart, pdfNote, assignment, or attachment) for a specific student/course.
 *
 * Key:  studentId + courseId + itemId  (unique index)
 *
 * itemId is the resource subdocument's _id.toString() when available, or the
 * deterministic composite key `lessonId:arrayType:arrayIndex` for legacy items
 * that were saved before the resourceSchema _id was enabled.
 */
const contentItemProgressSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    moduleId: {
      type: String,
      required: true,
    },
    lessonId: {
      type: String,
      required: true,
    },
    /**
     * Stable identifier for the content item.
     * Either the resource subdocument ObjectId or the composite fallback key.
     */
    itemId: {
      type: String,
      required: true,
    },
    /**
     * Which resource array the item came from.
     * One of: 'videoPart' | 'pdfNote' | 'assignment' | 'attachment'
     */
    itemType: {
      type: String,
      enum: ['videoPart', 'pdfNote', 'assignment', 'attachment'],
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastAccessedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Primary uniqueness constraint: one record per student + course + item
contentItemProgressSchema.index(
  { studentId: 1, courseId: 1, itemId: 1 },
  { unique: true }
);

// Fast lookups when fetching all completed items for a student/course pair
contentItemProgressSchema.index({ studentId: 1, courseId: 1 });

module.exports =
  mongoose.models.ContentItemProgress ||
  mongoose.model('ContentItemProgress', contentItemProgressSchema);
