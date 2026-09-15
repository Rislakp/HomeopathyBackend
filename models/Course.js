const mongoose = require('mongoose');
const Counter = require('./Counter');

// Shared subdocument schema for any file/resource (video part, PDF note, attachment)
const resourceSchema = new mongoose.Schema({
  title:         { type: String, trim: true, default: '' },
  url:           { type: String, trim: true, default: '' },
  public_id:     { type: String, trim: true, default: '' },
  resource_type: { type: String, trim: true, default: '' },
  mimetype:      { type: String, trim: true, default: '' },
  duration:      { type: Number, default: 0 },
  size:          { type: Number, default: 0 },
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
    default: '',
    trim: true,
  },
  duration: {
    type: String,
    default: '',
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
  courseBanner: {
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

// Getter helper for resolving primary banner without triggering path getters recursively
function getPrimaryBanner(doc) {
  if (!doc) return '';
  if (doc._doc) {
    return doc._doc.courseBanner || doc._doc.thumbnail || doc._doc.bannerUrl || '';
  }
  if (typeof doc.get === 'function') {
    return doc.get('courseBanner', null, { getters: false }) ||
           doc.get('thumbnail', null, { getters: false }) ||
           doc.get('bannerUrl', null, { getters: false }) || '';
  }
  return doc.courseBanner || doc.thumbnail || doc.bannerUrl || '';
}

// Path getters so accessing courseBanner, thumbnail, or bannerUrl always returns the available banner URL
courseSchema.path('thumbnail').get(function(v) {
  return v || getPrimaryBanner(this);
});
courseSchema.path('bannerUrl').get(function(v) {
  return v || getPrimaryBanner(this);
});
courseSchema.path('courseBanner').get(function(v) {
  return v || getPrimaryBanner(this);
});

// Synchronize banner fields on save
courseSchema.pre('save', function(next) {
  const primary = getPrimaryBanner(this);
  if (primary) {
    if (!this.thumbnail) this.thumbnail = primary;
    if (!this.bannerUrl) this.bannerUrl = primary;
    if (!this.courseBanner) this.courseBanner = primary;
  }
  next();
});

// Virtual alias for description -> shortDescription
courseSchema.virtual('description')
  .get(function() { return this.shortDescription; })
  .set(function(val) { this.shortDescription = val; });

// API-friendly aliases for the legacy courseTitle/shortDescription storage.
courseSchema.virtual('title')
  .get(function() { return this.courseTitle; })
  .set(function(val) { this.courseTitle = val; });

// Virtual aliases for banner/thumbnail fields
const bannerAliasFields = ['banner', 'thumbnailUrl', 'image', 'imageUrl'];
bannerAliasFields.forEach((field) => {
  courseSchema.virtual(field)
    .get(function() { return getPrimaryBanner(this); })
    .set(function(val) {
      this.thumbnail = val;
      this.bannerUrl = val;
      this.courseBanner = val;
    });
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