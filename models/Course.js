const mongoose = require('mongoose');
const Counter = require('./Counter');

const moduleSchema = new mongoose.Schema({
  moduleName: {
    type: String,
    required: [true, 'Please add a module name'],
    trim: true,
  },
  duration: {
    type: String,
    trim: true,
    default: '',
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  assignedSubjects: {
    type: [String],
    default: [],
  },
  lessons: {
    type: Array,
    default: [],
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual aliases for backwards compatibility
moduleSchema.virtual('moduleTitle')
  .get(function() { return this.moduleName; })
  .set(function(val) { this.moduleName = val; });

moduleSchema.virtual('moduleId')
  .get(function() { return this._id ? this._id.toString() : undefined; });

const courseSchema = new mongoose.Schema({
  courseId: {
    type: String,
    required: true,
    unique: true,
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
  thumbnail: {
    type: String,
    trim: true,
    default: '',
  },
  modules: {
    type: [moduleSchema],
    default: [],
  },
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
const bannerAliasFields = ['banner', 'bannerUrl', 'thumbnailUrl', 'image', 'imageUrl', 'courseBanner'];
bannerAliasFields.forEach((field) => {
  courseSchema.virtual(field)
    .get(function() { return this.thumbnail; })
    .set(function(val) { this.thumbnail = val; });
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