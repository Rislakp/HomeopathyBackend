const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  courseTitle: { type: String },
  thumbnail: { type: String, default: '' },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

const bannerFields = ['banner', 'bannerUrl', 'thumbnailUrl', 'image', 'imageUrl', 'courseBanner'];
bannerFields.forEach((field) => {
  courseSchema.virtual(field)
    .get(function() { return this.thumbnail; })
    .set(function(val) { this.thumbnail = val; });
});

const Course = mongoose.model('TestCourse', courseSchema);

// Test 1: Instantiation with 'banner'
const c1 = new Course({ courseTitle: 'Course 1', banner: 'https://example.com/banner1.jpg' });
console.log('Test 1 - c1.thumbnail:', c1.thumbnail);
console.log('Test 1 - c1.toJSON():', c1.toJSON());

// Test 2: Instantiation with 'courseBanner'
const c2 = new Course({ courseTitle: 'Course 2', courseBanner: 'https://example.com/banner2.jpg' });
console.log('Test 2 - c2.thumbnail:', c2.thumbnail);
console.log('Test 2 - c2.toJSON():', c2.toJSON());

// Test 3: Setting property directly
const c3 = new Course({ courseTitle: 'Course 3', thumbnail: 'https://example.com/thumb3.jpg' });
console.log('Test 3 - c3.banner:', c3.banner);
console.log('Test 3 - c3.courseBanner:', c3.courseBanner);
