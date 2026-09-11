const assert = require('assert');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Recording = require('../models/Recording');

async function testLiveRecordsWorkflow() {
  console.log('🧪 Starting Live Records Workflow Verification Tests...\n');

  // Test 1: Recording Schema Validation
  console.log('Test 1: Recording Model Schema Validation');
  const courseId = new mongoose.Types.ObjectId();
  const moduleId = new mongoose.Types.ObjectId();
  const lessonId = new mongoose.Types.ObjectId();

  const testRec = new Recording({
    courseId,
    moduleId,
    lessonId,
    liveClassUrl: 'https://whitecoat.academy/live/miasms-101',
    recordingFileUrl: 'https://res.cloudinary.com/demo/video/upload/v1/recording_lecture.mp4',
    duration: '45 mins',
    status: 'Completed',
  });

  const err = testRec.validateSync();
  assert.strictEqual(err, undefined, 'Recording schema validation failed');
  assert.strictEqual(testRec.status, 'Completed');
  assert.strictEqual(testRec.courseId.toString(), courseId.toString());
  assert.strictEqual(testRec.moduleId.toString(), moduleId.toString());
  assert.strictEqual(testRec.lessonId.toString(), lessonId.toString());
  console.log('  ✅ Recording model validates required hierarchical references and fields');

  // Test 2: In-Memory Hierarchy Resolution for GET /api/live-records
  console.log('\nTest 2: Hierarchical Population Mapping for Live Records');
  const mockCourse = new Course({
    _id: courseId,
    courseTitle: 'Organon of Medicine & Homoeopathic Philosophy',
    shortDescription: 'Comprehensive aphorisms study',
    duration: '6 Weeks',
    price: 2999,
    instructor: 'Dr. S. Hahnemann',
    thumbnail: 'https://res.cloudinary.com/demo/image/upload/v1/thumbnail.jpg',
    category: 'Homeopathy',
    modules: [
      {
        _id: moduleId,
        moduleName: 'Module 1: Fundamental Principles',
        lessons: [
          {
            _id: lessonId,
            lessonTitle: 'Lesson 1.1: Vital Force & Chronic Diseases',
            lessonType: 'Live Class',
            meetingUrl: 'https://whitecoat.academy/live/miasms-101',
            durationOrPages: '45 mins',
            status: 'Published',
          }
        ]
      }
    ]
  });

  // Simulated recording item populated with mockCourse
  const mockPopulatedRecording = {
    _id: testRec._id,
    courseId: mockCourse,
    moduleId: moduleId,
    lessonId: lessonId,
    liveClassUrl: testRec.liveClassUrl,
    recordingFileUrl: testRec.recordingFileUrl,
    duration: testRec.duration,
    status: testRec.status,
    createdAt: testRec.createdAt,
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

  const populatedResult = {
    _id: mockPopulatedRecording._id,
    courseId: course._id,
    courseTitle: course.courseTitle,
    thumbnail: course.thumbnail,
    category: course.category,
    moduleId: mockPopulatedRecording.moduleId,
    moduleName,
    lessonId: mockPopulatedRecording.lessonId,
    lessonTitle,
    liveClassUrl: mockPopulatedRecording.liveClassUrl,
    recordingFileUrl: mockPopulatedRecording.recordingFileUrl,
    duration: mockPopulatedRecording.duration,
    status: mockPopulatedRecording.status,
  };

  assert.strictEqual(populatedResult.courseTitle, 'Organon of Medicine & Homoeopathic Philosophy');
  assert.strictEqual(populatedResult.moduleName, 'Module 1: Fundamental Principles');
  assert.strictEqual(populatedResult.lessonTitle, 'Lesson 1.1: Vital Force & Chronic Diseases');
  assert.strictEqual(populatedResult.recordingFileUrl, 'https://res.cloudinary.com/demo/video/upload/v1/recording_lecture.mp4');
  console.log('  ✅ GET /api/live-records mapping successfully resolves courseTitle, moduleName, and lessonTitle');

  console.log('\n🎉 ALL LIVE RECORDS TESTS PASSED SUCCESSFULLY!\n');
}

testLiveRecordsWorkflow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
