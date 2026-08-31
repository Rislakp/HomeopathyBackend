const mongoose = require('mongoose');
const Counter = require('./Counter');

const courseSchema = new mongoose.Schema({
  courseId: {
    type: String,
    required: true,
    unique: true
  },
  courseTitle: {
    type: String,
    required: [true, 'Please add a course title'],
    trim: true
  },
  instructor: {
    type: String,
    required: [true, 'Please add an instructor name'],
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Please specify a category'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'Please specify a price'],
    min: [0, 'Price must be at least 0']
  }
}, {
  timestamps: true
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
      
      // FIXED: Added backticks around the template literal
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