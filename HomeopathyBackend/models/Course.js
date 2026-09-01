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