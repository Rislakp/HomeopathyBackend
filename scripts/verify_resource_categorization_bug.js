const assert = require('assert');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');

async function verifyCategorizationFix() {
  console.log('🧪 Verifying Resource Categorization Bug Fix...\n');

  const mockModuleId = new mongoose.Types.ObjectId();
  const mockLessonId = new mongoose.Types.ObjectId();

  const mockCourse = new Course({
    _id: new mongoose.Types.ObjectId(),
    courseTitle: 'Organon of Medicine Special',
    modules: [{
      _id: mockModuleId,
      moduleName: 'Module 1',
      lessons: [{
        _id: mockLessonId,
        lessonTitle: 'Case Taking Aphorisms',
        lessonType: 'Recorded Video',
        pdfNotes: [
          {
            title: 'pg-5-Q.pdf',
            url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/pg-5-Q.pdf',
            secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/pg-5-Q.pdf',
            public_id: 'homeopathy-media/pdf-notes/pg-5-Q.pdf',
            resource_type: 'raw',
          }
        ],
        attachments: [],
        assignments: [],
      }]
    }]
  });

  Course.findById = () => ({
    exec: async () => mockCourse,
  });

  Course.findOne = () => {
    const query = Promise.resolve(mockCourse);
    query.exec = async () => mockCourse;
    return query;
  };

  mockCourse.save = async () => mockCourse;

  // Test 1: Uploading an assignment file (question-demo.pdf) via updateLesson
  console.log('Test 1: Updating lesson with question-demo.pdf as an attachment/assignment');

  const updateReq = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: mockModuleId.toString(),
      lessonId: mockLessonId.toString(),
    },
    body: {
      lessonTitle: 'Case Taking Aphorisms Updated',
      uploadType: 'attachment',
    },
    files: [
      {
        fieldname: 'attachments',
        originalname: 'question-demo.pdf',
        mimetype: 'application/pdf',
        secure_url: 'https://res.cloudinary.com/vadgpisw/raw/upload/v1/question-demo.pdf',
        public_id: 'homeopathy-media/attachments/question-demo.pdf',
        resource_type: 'raw',
      }
    ],
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

  assert.strictEqual(updateStatus, 200, `Expected 200, got ${updateStatus}`);
  const updatedLesson = updateJson.data;

  console.log('\n--- VERIFICATION RESULTS ---');
  console.log('pdfNotes count:', updatedLesson.pdfNotes.length);
  console.log('pdfNotes titles:', updatedLesson.pdfNotes.map(p => p.title));
  console.log('attachments count:', updatedLesson.attachments.length);
  console.log('attachments titles:', updatedLesson.attachments.map(a => a.title));

  assert.strictEqual(updatedLesson.pdfNotes.length, 1, 'pdfNotes must contain exactly 1 item (pg-5-Q.pdf)');
  assert.strictEqual(updatedLesson.pdfNotes[0].title, 'pg-5-Q.pdf');

  assert.strictEqual(updatedLesson.attachments.length, 1, 'attachments must contain exactly 1 item (question-demo.pdf)');
  assert.strictEqual(updatedLesson.attachments[0].title, 'question-demo.pdf');

  const isDuplicateInPdfNotes = updatedLesson.pdfNotes.some(p => p.title === 'question-demo.pdf' || p.public_id.includes('question-demo'));
  assert.strictEqual(isDuplicateInPdfNotes, false, 'question-demo.pdf MUST NOT be duplicated into pdfNotes');

  console.log('\n✅ Test 1 Passed: question-demo.pdf is stored ONLY in attachments and NOT in pdfNotes.\n');

  // Test 2: Verify GET Lesson API returns properly segregated categories
  console.log('Test 2: GET /api/courses/:courseId/modules/:moduleId/lessons');
  const getReq = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: mockModuleId.toString(),
    },
    protocol: 'https',
    get: () => 'api.homeopathy.com',
  };

  let getStatus = null;
  let getJson = null;
  const getRes = {
    status: (code) => {
      getStatus = code;
      return {
        json: (data) => {
          getJson = data;
          return data;
        }
      };
    }
  };

  await courseController.getLessonsByModule(getReq, getRes);
  assert.strictEqual(getStatus, 200);
  const fetchedLesson = getJson.data[0];

  assert.strictEqual(fetchedLesson.pdfNotes.length, 1);
  assert.strictEqual(fetchedLesson.pdfNotes[0].title, 'pg-5-Q.pdf');
  assert.strictEqual(fetchedLesson.attachments.length, 1);
  assert.strictEqual(fetchedLesson.attachments[0].title, 'question-demo.pdf');

  console.log('✅ Test 2 Passed: GET Lesson API returns pdfNotes = [pg-5-Q.pdf] and attachments = [question-demo.pdf].\n');

  // Test 3: Ensure legitimate different files with same filename are preserved
  console.log('Test 3: Preserving legitimate different files with same title but different public_ids');
  const multiFileLesson = {
    _id: new mongoose.Types.ObjectId(),
    lessonTitle: 'Multi-file Lesson',
    pdfNotes: [
      {
        title: 'reference.pdf',
        url: 'https://res.cloudinary.com/demo/raw/upload/v1/pdfnotes/ref.pdf',
        public_id: 'pdfnotes/ref.pdf',
      }
    ],
    attachments: [
      {
        title: 'reference.pdf',
        url: 'https://res.cloudinary.com/demo/raw/upload/v1/attachments/ref.pdf',
        public_id: 'attachments/ref.pdf',
      }
    ],
    assignments: [],
    videoParts: [],
  };

  mockCourse.modules[0].lessons.push(multiFileLesson);
  const getReq2 = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: mockModuleId.toString(),
    },
    protocol: 'https',
    get: () => 'api.homeopathy.com',
  };

  await courseController.getLessonsByModule(getReq2, getRes);
  const fetchedLesson2 = getJson.data[1];

  assert.strictEqual(fetchedLesson2.pdfNotes.length, 1, 'pdfNotes retains reference.pdf (pdfnotes/ref.pdf)');
  assert.strictEqual(fetchedLesson2.attachments.length, 1, 'attachments retains reference.pdf (attachments/ref.pdf)');
  console.log('✅ Test 3 Passed: Files with same title but distinct public_ids are preserved in their respective categories.\n');

  console.log('🎉 ALL RESOURCE CATEGORIZATION VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

verifyCategorizationFix().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
