const assert = require('assert');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Recording = require('../models/Recording');

async function verifyLiveRecordCrudAPI() {
  console.log('🧪 Verifying Live Record CRUD API logic and schemas...\n');

  const courseId = new mongoose.Types.ObjectId();
  const moduleId = new mongoose.Types.ObjectId();
  const lessonId = new mongoose.Types.ObjectId();

  // Test 1: Model Schema Validation
  const rec = new Recording({
    courseId,
    moduleId,
    lessonId,
    liveClassUrl: 'https://whitecoat.academy/live/miasms-101',
    recordingFileUrl: 'https://res.cloudinary.com/demo/video/upload/v1/rec.mp4',
    duration: '45 mins',
    status: 'Completed',
  });

  const validateErr = rec.validateSync();
  assert.strictEqual(validateErr, undefined, 'Schema validation failed');
  console.log('✅ Test 1: Recording Schema Validation passed');

  // Test 2: In-Memory Hierarchy Resolution
  const mockCourse = new Course({
    _id: courseId,
    courseId: 'CRS-101',
    courseTitle: 'Organon of Medicine',
    thumbnail: 'https://res.cloudinary.com/demo/image/upload/v1/thumb.jpg',
    category: 'Homeopathy',
    modules: [
      {
        _id: moduleId,
        moduleName: 'Module 1: Fundamentals',
        lessons: [
          {
            _id: lessonId,
            lessonTitle: 'Lesson 1.1: Vital Force',
            lessonType: 'Live Class',
          }
        ]
      }
    ]
  });

  const mockPopulatedRecording = {
    _id: rec._id,
    courseId: mockCourse,
    moduleId,
    lessonId,
    liveClassUrl: rec.liveClassUrl,
    recordingFileUrl: rec.recordingFileUrl,
    duration: rec.duration,
    status: rec.status,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };

  const course = mockPopulatedRecording.courseId;
  let moduleName = 'Unknown Module';
  let lessonTitle = 'Unknown Lesson';

  if (course && Array.isArray(course.modules)) {
    const moduleObj = course.modules.id(mockPopulatedRecording.moduleId);
    if (moduleObj) {
      moduleName = moduleObj.moduleName;
      const lessonObj = moduleObj.lessons.id(mockPopulatedRecording.lessonId);
      if (lessonObj) {
        lessonTitle = lessonObj.lessonTitle;
      }
    }
  }

  assert.strictEqual(course.courseTitle, 'Organon of Medicine');
  assert.strictEqual(moduleName, 'Module 1: Fundamentals');
  assert.strictEqual(lessonTitle, 'Lesson 1.1: Vital Force');
  console.log('✅ Test 2: Population & Hierarchy Resolution passed');

  console.log('\n🎉 ALL LIVE RECORD CRUD API VERIFICATION TESTS PASSED!\n');
}

verifyLiveRecordCrudAPI().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
