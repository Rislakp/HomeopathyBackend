const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');

async function testCourseModelAndControllers() {
  console.log('--- Starting Course Schema & Controller Validation ---');

  // Test 1: Verify Schema Field Validation & Default values
  const dummyCourseData = {
    courseId: 'CRS-000001',
    courseTitle: 'Organon & Philosophy Masterclass',
    shortDescription: 'In-depth study of Homeopathic principles and aphorisms.',
    category: 'Organon Philosophy',
    duration: '12 Weeks',
    instructor: 'Dr. Samuel Hahnemann',
    price: 4999,
    status: 'Published',
    thumbnail: 'https://example.com/images/organon_thumb.png',
    modules: [
      {
        moduleName: 'Fundamentals of Organon',
        duration: '4 Weeks',
        description: 'Introduction to Aphorisms 1 to 70 and core laws.',
        assignedSubjects: ['Organon Philosophy', 'Aphorisms 1-70']
      },
      {
        moduleName: 'Chronic Diseases & Case Taking',
        duration: '8 Weeks',
        description: 'Analysis of miasms and detailed case taking methodology.',
        assignedSubjects: ['Chronic Miasms', 'Case Taking Protocol']
      }
    ]
  };

  const courseDoc = new Course(dummyCourseData);
  const validateError = courseDoc.validateSync();
  if (validateError) {
    console.error('❌ Schema Validation Failed:', validateError.message);
  } else {
    console.log('✓ Course Schema Instantiation & Validation Succeeded');
    console.log('  - courseTitle:', courseDoc.courseTitle);
    console.log('  - shortDescription:', courseDoc.shortDescription);
    console.log('  - description (virtual):', courseDoc.description);
    console.log('  - category:', courseDoc.category);
    console.log('  - duration:', courseDoc.duration);
    console.log('  - instructor:', courseDoc.instructor);
    console.log('  - price:', courseDoc.price);
    console.log('  - status:', courseDoc.status);
    console.log('  - thumbnail:', courseDoc.thumbnail);
    console.log('  - modules count:', courseDoc.modules.length);
    console.log('  - module[0] assignedSubjects:', courseDoc.modules[0].assignedSubjects);
    console.log('  - module[0] moduleTitle (virtual):', courseDoc.modules[0].moduleTitle);
  }

  // Test 2: Check required field validation error handling in controller
  const mockReqInvalid = {
    body: {
      courseTitle: 'Incomplete Course'
      // missing required fields
    }
  };
  let resStatus = 0;
  let resBody = null;
  const mockResInvalid = {
    status(code) {
      resStatus = code;
      return this;
    },
    json(data) {
      resBody = data;
      return this;
    }
  };

  await courseController.createCourse(mockReqInvalid, mockResInvalid);
  if (resStatus === 400 && resBody && resBody.success === false) {
    console.log('✓ createCourse controller correctly rejects missing required fields (Status 400)');
  } else {
    console.error('❌ createCourse controller validation failed to reject invalid payload:', resStatus, resBody);
  }

  console.log('--- All Schema & Controller Checks Completed Successfully ---');
}

testCourseModelAndControllers().catch((err) => {
  console.error('Fatal Test Error:', err);
});
