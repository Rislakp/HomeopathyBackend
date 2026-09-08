const mongoose = require('mongoose');
const Counter = require('./Counter');

// Shared subdocument schema for any file/resource (video part, PDF note, attachment)
const resourceSchema = new mongoose.Schema({
  title: { type: String, trim: true, default: '' },
  url:   { type: String, trim: true, default: '' },
}, { _id: false });

// Subdocument Schema for Lessons
const lessonSchema = new mongoose.Schema({
  lessonTitle: {
    type: String,
    required: [true, 'Please provide a lesson title'],
    trim: true,
  },
  lessonType: {
    type: String,
    // Covers all values the Flutter admin frontend may send.
    // Short aliases (Video, PDF, Live, Assignment) are kept for
    // backward compatibility with any existing records.
    enum: [
      'Recorded Video', 'Live Class', 'PDF Notes', 'Assignment',
      'Video', 'PDF', 'Live',
      'video', 'pdf', 'link', 'document', 'audio',
    ],
    default: 'Recorded Video',
  },
  durationOrPages: {
    type: String,
    trim: true,
    default: '',
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  meetingUrl: {
    type: String,
    trim: true,
    default: '',
  },
  videoUrl: {
    type: String,
    trim: true,
    default: '',
  },
  videoParts:   { type: [resourceSchema], default: [] },
  pdfNotes:     { type: [resourceSchema], default: [] },
  attachments:  { type: [resourceSchema], default: [] },
  status: {
    type: String,
    enum: ['Published', 'Draft'],
    default: 'Published',
  },
}, {
  timestamps: true,
});

// Subdocument Schema for Modules
const moduleSchema = new mongoose.Schema({
  moduleName: {
    type: String,
    required: [true, 'Please provide a module name'],
    trim: true,
  },
  lessons: {
    type: [lessonSchema],
    default: [],
  }
}, {
  timestamps: true,
});

// Main Course Schema
const courseSchema = new mongoose.Schema({
  courseId: {
    type: String,
    unique: true,
    sparse: true,
  },
  courseTitle: {
    type: String,
    required: [true, 'Please add a course title'],
    trim: true,
  },
  shortDescription: {
    type: String,
    required: [true, 'Please add a short description'],
    trim: true,
  },
  duration: {
    type: String,
    required: [true, 'Please specify a duration'],
    trim: true,
  },
  instructor: {
    type: String,
    required: [true, 'Please add an instructor name'],
    trim: true,
  },
  price: {
    type: Number,
    required: [true, 'Please specify a price'],
    min: [0, 'Price must be at least 0'],
  },
  status: {
    type: String,
    enum: ['Published', 'Draft', 'Archived'],
    default: 'Published',
  },
  category: {
    type: String,
    trim: true,
    default: 'Homeopathy',
  },
  thumbnail: {
    type: String,
    trim: true,
    default: '',
  },
  bannerUrl: {
    type: String,
    trim: true,
    default: '',
  },
  modules: {
    type: [moduleSchema],
    default: [],
  },
  enrolledStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // or 'Student' depending on your architecture
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual alias for description -> shortDescription
courseSchema.virtual('description')
  .get(function() { return this.shortDescription; })
  .set(function(val) { this.shortDescription = val; });

// Virtual aliases for banner/thumbnail fields -> thumbnail
const bannerAliasFields = ['banner', 'thumbnailUrl', 'image', 'imageUrl', 'courseBanner'];
bannerAliasFields.forEach((field) => {
  courseSchema.virtual(field)
    .get(function() { return this.thumbnail; })
    .set(function(val) { this.thumbnail = val; });
});

// Virtual for enrolledCount
courseSchema.virtual('enrolledCount').get(function() {
  return this.enrolledStudents ? this.enrolledStudents.length : 0;
});

// Auto-generate unique courseId before validation
courseSchema.pre('validate', async function(next) {
  if (this.isNew && !this.courseId) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'courseId' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.courseId = `CRS-${String(counter.seq).padStart(6, '0')}`;
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model('Course', courseSchema);