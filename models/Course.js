const mongoose = require('mongoose');
const Counter = require('./Counter');

// Subdocument Schema for Lessons
const lessonSchema = new mongoose.Schema(
  {
    lessonTitle: {
      type: String,
      required: [true, 'Please provide a lesson title'],
      trim: true,
    },
    lessonType: {
      type: String,
      required: [true, 'Please specify a lesson type'],
      enum: {
        values: ['Live Class', 'Recorded Video', 'PDF Notes', 'Assignment'],
        message: '{VALUE} is not a valid lesson type',
      },
    },
    fileOrLink: {
      type: String,
      trim: true,
      default: '',
    },
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
  {
    timestamps: true,
  }
);

// Subdocument Schema for Modules
const moduleSchema = new mongoose.Schema(
  {
    moduleName: {
      type: String,
      required: [true, 'Please provide a module name'],
      trim: true,
    },
    lessons: [lessonSchema],
  },
  {
    timestamps: true,
  }
);

// Main Course Schema
const courseSchema = new mongoose.Schema(
  {
    courseId: {
      type: String,
      unique: true,
      sparse: true,
    },
    courseBanner: {
      type: String,
      trim: true,
      default: '',
    },
    courseTitle: {
      type: String,
      required: [true, 'Please add a course title'],
      trim: true,
    },
    instructor: {
      type: String,
      required: [true, 'Please add an instructor name'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Please specify a course price'],
      min: [0, 'Price must be a positive number'],
    },
    courseDescription: {
      type: String,
      required: [true, 'Please enter course overview and summary'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['Published', 'Draft'],
      default: 'Published',
    },
    category: {
      type: String,
      trim: true,
      default: 'Homeopathy',
    },
    modules: {
      type: [moduleSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

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
// Auto-generate unique courseId (CRS-000001) before validation if not provided
courseSchema.pre('validate', async function (next) {
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