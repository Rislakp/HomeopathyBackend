const assert = require('assert');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');

async function runTests() {
  console.log('🧪 Starting Assignment & PDF Notes Separation Tests...\n');

  // Test 1: Schema Subdocuments Isolation
  console.log('Test 1: Schema Verification for Separate Arrays');
  const course = new Course({
    courseTitle: 'Organon of Medicine',
    modules: [{
      moduleName: 'Introduction to Homeopathy',
      lessons: [{
        lessonTitle: 'Aphorism 1-5',
        lessonType: 'Recorded Video',
        pdfNotes: [
          {
            title: 'Aphorisms_1_to_5_Notes.pdf',
            url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/notes.pdf',
            secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/notes.pdf',
            resource_type: 'raw'
          }
        ],
        assignments: [
          {
            title: 'Aphorism_1_Case_Worksheet.pdf',
            url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/worksheet.pdf',
            secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/worksheet.pdf',
            resource_type: 'raw'
          }
        ],
        attachments: [
          {
            title: 'Reference_Chart.png',
            url: 'https://res.cloudinary.com/vadgpisw/image/upload/v1/chart.png',
            secure_url: 'https://res.cloudinary.com/vadgpisw/image/upload/v1/chart.png',
            resource_type: 'image'
          }
        ]
      }]
    }]
  });

  const lesson = course.modules[0].lessons[0];
  assert.strictEqual(lesson.pdfNotes.length, 1);
  assert.strictEqual(lesson.pdfNotes[0].title, 'Aphorisms_1_to_5_Notes.pdf');
  assert.strictEqual(lesson.assignments.length, 1);
  assert.strictEqual(lesson.assignments[0].title, 'Aphorism_1_Case_Worksheet.pdf');
  assert.strictEqual(lesson.attachments.length, 1);
  assert.strictEqual(lesson.attachments[0].title, 'Reference_Chart.png');
  console.log('  ✅ Mongoose schema stores pdfNotes, assignments, and attachments independently.\n');

  // Test 2: Simulating addLesson Controller Logic with Multipart & Body Arrays
  console.log('Test 2: Simulating addLesson with distinct assignment and pdfNotes files');
  
  // Create a mock course in memory
  const mockModuleId = new mongoose.Types.ObjectId();
  const mockCourse = new Course({
    _id: new mongoose.Types.ObjectId(),
    courseTitle: 'Pharmacy & Materia Medica',
    modules: [{
      _id: mockModuleId,
      moduleName: 'Module 1',
      lessons: []
    }]
  });

  // Mock findCourseByIdOrCustomId to return our mockCourse
  const originalFind = Course.findById;
  Course.findById = () => ({
    exec: async () => mockCourse,
  });

  // Simulate Add Lesson with both JSON arrays and uploaded files
  const req = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: mockModuleId.toString(),
    },
    body: {
      lessonTitle: 'Remedy Preparation & Case Study',
      lessonType: 'Assignment',
      durationOrPages: '30 mins',
      pdfNotes: JSON.stringify([
        {
          title: 'Remedy_Preparation_Guide.pdf',
          url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/guide.pdf',
          secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/guide.pdf',
          resource_type: 'raw',
        }
      ]),
      assignments: JSON.stringify([
        {
          title: 'Potency_Selection_Exercise.pdf',
          url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/exercise.pdf',
          secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/exercise.pdf',
          resource_type: 'raw',
        }
      ]),
    },
    files: [
      {
        fieldname: 'pdfNotes',
        originalname: 'Additional_Study_Material.pdf',
        mimetype: 'application/pdf',
        secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/study.pdf',
        resource_type: 'raw',
      },
      {
        fieldname: 'assignmentFiles',
        originalname: 'Patient_Case_Assignment_1.pdf',
        mimetype: 'application/pdf',
        secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/case1.pdf',
        resource_type: 'raw',
      }
    ],
    protocol: 'https',
    get: () => 'api.homeopathy.com',
  };

  let responseStatus = null;
  let responseJson = null;
  const res = {
    status: (code) => {
      responseStatus = code;
      return {
        json: (data) => {
          responseJson = data;
          return data;
        }
      };
    }
  };

  // Temporarily stub course.save
  mockCourse.save = async () => mockCourse;
  
  // Stub Course.findOne to return mockCourse directly as a thenable query
  Course.findOne = () => {
    const query = Promise.resolve(mockCourse);
    query.exec = async () => mockCourse;
    return query;
  };

  await courseController.addLesson(req, res);

  assert.strictEqual(responseStatus, 201, `Expected HTTP 201, got ${responseStatus}`);
  const createdLesson = responseJson.data;

  console.log('  Created Lesson in Response:');
  console.log('    pdfNotes count:   ', createdLesson.pdfNotes?.length);
  console.log('    assignments count:', createdLesson.assignments?.length);
  console.log('    attachments count:', createdLesson.attachments?.length);

  assert.strictEqual(createdLesson.pdfNotes.length, 2, 'Should have 2 PDF notes (1 from body, 1 uploaded file)');
  assert.strictEqual(createdLesson.assignments.length, 2, 'Should have 2 Assignments (1 from body, 1 uploaded file)');
  assert.strictEqual(createdLesson.attachments.length, 0, 'Attachments should remain empty without cross-pollination');

  assert.ok(createdLesson.pdfNotes.some((p) => p.title.includes('Guide') || p.title.includes('Study')));
  assert.ok(createdLesson.assignments.some((a) => a.title.includes('Exercise') || a.title.includes('Case')));

  console.log('  ✅ addLesson successfully processes and stores pdfNotes and assignments in separate arrays.\n');

  // Test 3: Serialization Output Verification
  console.log('Test 3: serializeLesson output structure');
  assert.ok(Array.isArray(createdLesson.pdfNotes), 'pdfNotes must be an array');
  assert.ok(Array.isArray(createdLesson.assignments), 'assignments must be an array');
  assert.ok(createdLesson.assignments[0].secure_url.startsWith('https://'), 'assignments should have secure_url');
  assert.ok(createdLesson.pdfNotes[0].secure_url.startsWith('https://'), 'pdfNotes should have secure_url');
  console.log('  ✅ serializeLesson provides independent, fully-formed arrays for frontend rendering.\n');

  // Test 4: Simulating updateLesson Controller Logic
  console.log('Test 4: Simulating updateLesson to verify independent updates');
  const savedLessonSubdoc = mockCourse.modules[0].lessons[0];
  const updateReq = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: mockModuleId.toString(),
      lessonId: savedLessonSubdoc._id.toString(),
    },
    body: {
      assignments: JSON.stringify([
        {
          title: 'Updated_Homework_Assignment.pdf',
          url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/updated_hw.pdf',
          secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/updated_hw.pdf',
          resource_type: 'raw',
        }
      ]),
    },
    protocol: 'https',
    get: () => 'api.homeopathy.com',
  };

  let updateStatus = null;
  let updateJson = null;
  const updateRes = {
    status: (code) => {
      updateStatus = code;
      return {
        json: (data) => {
          updateJson = data;
          return data;
        }
      };
    }
  };

  await courseController.updateLesson(updateReq, updateRes);

  assert.strictEqual(updateStatus, 200, `Expected HTTP 200, got ${updateStatus}`);
  const updatedLesson = updateJson.data;

  // Assignments was replaced by body payload
  assert.strictEqual(updatedLesson.assignments.length, 1);
  assert.strictEqual(updatedLesson.assignments[0].title, 'Updated_Homework_Assignment.pdf');
  // pdfNotes was NOT updated, so previous 2 pdfNotes should remain intact
  assert.strictEqual(updatedLesson.pdfNotes.length, 2, 'Existing pdfNotes must remain unchanged when only assignments are updated');
  assert.strictEqual(updatedLesson.attachments.length, 0);

  console.log('  ✅ updateLesson updates assignments without overwriting pdfNotes.\n');

  console.log('🎉 ALL ASSIGNMENT & PDF NOTES SEPARATION CHECKS PASSED!\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
