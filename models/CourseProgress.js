const mongoose = require('mongoose');

// One durable summary per student/course. LessonProgress remains the detailed
// source for positions and per-item flags; this model makes course dashboards
// and study-time updates inexpensive and atomic.
const courseProgressSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  completedItemIds: { type: [String], default: [] },
  totalItems: { type: Number, default: 0, min: 0 },
  completedItems: { type: Number, default: 0, min: 0 },
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  status: { type: String, enum: ['Not Started', 'In Progress', 'Completed'], default: 'Not Started' },
  studyTimeSeconds: { type: Number, default: 0, min: 0 },
  lastActivityAt: { type: Date, default: null },
}, { timestamps: true });

courseProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.models.CourseProgress || mongoose.model('CourseProgress', courseProgressSchema);
