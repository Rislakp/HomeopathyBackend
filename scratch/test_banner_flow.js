const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');

async function runBannerTests() {
  console.log('=== Banner Handling Test ===');

  // Test 1: Mongoose Course creation with 'banner' field
  const courseWithBanner = new Course({
    courseId: 'CRS-TEST01',
    courseTitle: 'Banner Test Course',
    shortDescription: 'Test description',
    duration: '6 Months',
    instructor: 'Dr. Test',
    price: 1000,
    banner: 'https://cdn.example.com/banners/course1_banner.png'
  });

  console.log('Test 1 - Stored DB thumbnail field:', courseWithBanner.thumbnail);
  console.log('Test 1 - Virtual banner field:', courseWithBanner.banner);
  console.log('Test 1 - Virtual courseBanner field:', courseWithBanner.courseBanner);
  console.log('Test 1 - JSON output contains banner:', JSON.stringify(courseWithBanner.toJSON()).includes('course1_banner.png'));

  // Test 2: Mongoose Course creation with 'courseBanner' field
  const courseWithCourseBanner = new Course({
    courseId: 'CRS-TEST02',
    courseTitle: 'Course Banner Test',
    shortDescription: 'Test description 2',
    duration: '3 Months',
    instructor: 'Dr. Test 2',
    price: 2000,
    courseBanner: 'https://cdn.example.com/banners/course2_banner.png'
  });

  console.log('Test 2 - Stored DB thumbnail field:', courseWithCourseBanner.thumbnail);
  console.log('Test 2 - JSON output contains courseBanner:', JSON.stringify(courseWithCourseBanner.toJSON()).includes('course2_banner.png'));

  // Test 3: Controller createCourse mock test with 'banner' payload
  let savedCourse = null;
  const mockReq = {
    body: {
      courseTitle: 'Controller Banner Course',
      description: 'Overview text',
      duration: '4 Weeks',
      instructor: 'Dr. Controller',
      price: 1500,
      banner: 'https://cdn.example.com/banners/controller_banner.jpg'
    }
  };

  const mockRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    }
  };

  // Mock save
  const originalSave = Course.prototype.save;
  Course.prototype.save = async function() {
    savedCourse = this;
    return this;
  };

  try {
    await courseController.createCourse(mockReq, mockRes);
    console.log('Test 3 - Controller status:', mockRes.statusCode);
    console.log('Test 3 - Saved course thumbnail:', savedCourse ? savedCourse.thumbnail : null);
    console.log('Test 3 - Response data thumbnail:', mockRes.data.data.thumbnail);
    console.log('Test 3 - Response data banner:', mockRes.data.data.banner);
  } finally {
    Course.prototype.save = originalSave;
  }

  console.log('=== All Banner Tests Completed Successfully ===');
}

runBannerTests().catch(console.error);
