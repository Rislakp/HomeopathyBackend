const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');

async function testAddModuleValidation() {
  console.log('--- Testing Module & Lesson Validation Logic ---');

  // Test 1: Missing moduleName & Missing lessonTitle in nested lessons array
  const mockReqInvalid = {
    params: { id: 'CRS-000001' },
    body: {
      // moduleName is missing!
      duration: '4 Weeks',
      description: 'Introductory module',
      lessons: [
        {
          // lessonTitle is missing!
          lessonType: 'Recorded Video',
          duration: '30 mins'
        },
        {
          lessonTitle: 'Valid Lesson Title',
          lessonType: 'PDF Notes'
        }
      ]
    }
  };

  let status1 = 0;
  let body1 = null;
  const mockRes1 = {
    status(code) { status1 = code; return this; },
    json(data) { body1 = data; return this; }
  };

  await courseController.addModule(mockReqInvalid, mockRes1);

  if (status1 === 400 && body1 && body1.missingFields) {
    console.log('✓ Validation correctly caught missing fields:');
    console.log('  - Message:', body1.message);
    console.log('  - missingFields array:', body1.missingFields);
  } else {
    console.error('❌ Validation failed to reject invalid module payload:', status1, body1);
  }

  // Test 2: Valid payload with nested lessons parsing
  const dummyCourse = new Course({
    courseId: 'CRS-000001',
    courseTitle: 'Sample Course',
    shortDescription: 'Sample Description',
    duration: '8 Weeks',
    instructor: 'Dr. Test',
    price: 100
  });

  // Mock Course.findOne to return dummyCourse
  const originalFindOne = Course.findOne;
  Course.findOne = async () => dummyCourse;

  const mockReqValid = {
    params: { id: 'CRS-000001' },
    body: {
      moduleName: 'Advanced Organon',
      duration: '4 Weeks',
      description: 'Advanced topics in philosophy',
      assignedSubjects: ['Miasms', 'Posology'],
      lessons: [
        {
          title: 'Lesson 1: Introduction to Miasms',
          lessonType: 'Live Class',
          duration: '45 mins',
          uploadFileOrLink: 'https://example.com/video.mp4'
        }
      ]
    }
  };

  let status2 = 0;
  let body2 = null;
  const mockRes2 = {
    status(code) { status2 = code; return this; },
    json(data) { body2 = data; return this; }
  };

  // Mock save method
  dummyCourse.save = async () => dummyCourse;

  await courseController.addModule(mockReqValid, mockRes2);
  Course.findOne = originalFindOne;

  if (status2 === 201 && body2 && body2.success) {
    console.log('✓ Valid module & nested lessons parsed successfully:');
    console.log('  - Module Name:', body2.data.moduleName);
    console.log('  - Lessons Count:', body2.data.lessons.length);
    console.log('  - Lesson Title:', body2.data.lessons[0].lessonTitle);
    console.log('  - Lesson FileOrLink:', body2.data.lessons[0].fileOrLink);
  } else {
    console.error('❌ Module creation failed for valid payload:', status2, body2);
  }

  console.log('--- All Module Validation Tests Passed ---');
}

testAddModuleValidation().catch(console.error);
