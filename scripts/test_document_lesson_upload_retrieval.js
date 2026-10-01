require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');
const { isCloudinaryConfigured, uploadBufferToCloudinary, parseCloudinaryUrl } = require('../config/cloudinary');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.data = body;
      return this;
    }
  };
}

async function runTests() {
  console.log('🧪 Starting Document/Lesson Upload & Cloudinary Retrieval Verification Test Suite...\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const timestamp = Date.now();
  let testCourse = null;
  let moduleId = null;
  let lessonId = null;

  try {
    // ------------------------------------------------------------------
    // TEST 1: Cloudinary Configuration & Raw Resource Handling
    // ------------------------------------------------------------------
    console.log('\n--- TEST 1: Cloudinary Configuration & Raw Upload Setup ---');
    console.log(`Cloudinary configured: ${isCloudinaryConfigured()}`);
    
    // Validate that Cloudinary URL parser detects raw PDF URLs properly
    const sampleRawPdfUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1726000000/homeopathy-media/pdf-notes/organon_notes_123.pdf';
    const parsedPdf = parseCloudinaryUrl(sampleRawPdfUrl);
    assert.ok(parsedPdf, 'parseCloudinaryUrl must parse valid Cloudinary URL');
    assert.strictEqual(parsedPdf.resourceType, 'raw', 'PDF must be parsed as raw resource type');
    assert.ok(parsedPdf.publicId.endsWith('.pdf'), 'Raw PDF public_id must retain .pdf extension');
    console.log('✅ PASS: Cloudinary URL parser preserves raw resourceType and .pdf extension.');

    // ------------------------------------------------------------------
    // TEST 2: Create Course & Module
    // ------------------------------------------------------------------
    console.log('\n--- TEST 2: Create Test Course with Module ---');
    testCourse = await Course.create({
      courseId: `CRS-DOC-TEST-${timestamp}`,
      courseTitle: 'Homeopathic Philosophy & Case Taking',
      instructor: 'Dr. J.T. Kent',
      price: 3500,
      modules: [
        {
          moduleName: 'Module 1: Introduction to Organon',
          lessons: []
        }
      ]
    });
    moduleId = testCourse.modules[0]._id.toString();
    console.log(`✅ Test course created (_id: ${testCourse._id}, courseId: ${testCourse.courseId}, moduleId: ${moduleId})`);

    // ------------------------------------------------------------------
    // TEST 3: Add Lesson with PDF Notes and Attachment via addLesson
    // ------------------------------------------------------------------
    console.log('\n--- TEST 3: Add Lesson with PDF Notes and Attachment ---');
    const mockPdfUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1726000001/homeopathy-media/pdf-notes/Kent_Lectures_Chapter1.pdf';
    const mockAttachmentUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1726000002/homeopathy-media/attachments/Clinical_Case_Form.docx';

    const addLessonReq = {
      params: {
        courseId: testCourse.courseId,
        moduleId: moduleId,
      },
      body: {
        lessonTitle: 'Lecture 1: The Sick (Aphorisms 1-4)',
        lessonType: 'PDF Notes',
        durationOrPages: '24 pages',
        description: 'Detailed commentary on Organon of Medicine',
        pdfNotes: JSON.stringify([
          {
            title: 'Kent Lectures Chapter 1 PDF',
            url: mockPdfUrl,
            secure_url: mockPdfUrl,
            resource_type: 'raw',
            mimetype: 'application/pdf',
            size: 1048576,
          }
        ]),
        attachments: JSON.stringify([
          {
            title: 'Clinical Case Form',
            url: mockAttachmentUrl,
            secure_url: mockAttachmentUrl,
            resource_type: 'raw',
            mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 524288,
          }
        ])
      },
      file: null,
      files: []
    };

    const mockResAdd = createMockRes();
    await courseController.addLesson(addLessonReq, mockResAdd);

    assert.strictEqual(mockResAdd.statusCode, 201, 'addLesson should return status 201');
    assert.strictEqual(mockResAdd.data.success, true, 'success should be true');

    const addedLesson = mockResAdd.data.data;
    lessonId = addedLesson._id.toString();
    console.log(`✅ Lesson added successfully (_id: ${lessonId})`);

    // Verify PDF notes metadata
    assert.strictEqual(addedLesson.pdfNotes.length, 1, 'Should have 1 PDF note');
    const pdfNote = addedLesson.pdfNotes[0];
    assert.strictEqual(pdfNote.url, mockPdfUrl);
    assert.strictEqual(pdfNote.secure_url, mockPdfUrl);
    assert.strictEqual(pdfNote.fileUrl, mockPdfUrl, 'fileUrl must match secure_url');
    assert.strictEqual(pdfNote.documentUrl, mockPdfUrl, 'documentUrl must match secure_url');
    assert.strictEqual(pdfNote.path, mockPdfUrl, 'path must match secure_url');
    assert.strictEqual(pdfNote.resource_type, 'raw');

    // Verify Attachment metadata
    assert.strictEqual(addedLesson.attachments.length, 1, 'Should have 1 attachment');
    const attachment = addedLesson.attachments[0];
    assert.strictEqual(attachment.url, mockAttachmentUrl);
    assert.strictEqual(attachment.secure_url, mockAttachmentUrl);
    assert.strictEqual(attachment.fileUrl, mockAttachmentUrl, 'fileUrl must match secure_url');
    assert.strictEqual(attachment.documentUrl, mockAttachmentUrl, 'documentUrl must match secure_url');
    assert.strictEqual(attachment.path, mockAttachmentUrl, 'path must match secure_url');

    // Verify Lesson-level document URL fields
    assert.strictEqual(addedLesson.fileUrl, mockPdfUrl, 'Lesson-level fileUrl must be populated');
    assert.strictEqual(addedLesson.documentUrl, mockPdfUrl, 'Lesson-level documentUrl must be populated');
    assert.strictEqual(addedLesson.pdfUrl, mockPdfUrl, 'Lesson-level pdfUrl must be populated');
    assert.strictEqual(addedLesson.url, mockPdfUrl, 'Lesson-level url must be populated');
    console.log('✅ PASS: addLesson saved PDF notes and attachments with all document URL aliases populated.');

    // ------------------------------------------------------------------
    // TEST 4: Update Lesson via updateLesson
    // ------------------------------------------------------------------
    console.log('\n--- TEST 4: Update Lesson with Additional Supplementary PDF ---');
    const mockSupplementaryPdfUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1726000003/homeopathy-media/pdf-notes/Miasms_Supplementary.pdf';

    const updateLessonReq = {
      params: {
        courseId: testCourse.courseId,
        moduleId: moduleId,
        lessonId: lessonId,
      },
      body: {
        lessonTitle: 'Lecture 1: The Sick (Aphorisms 1-4) - Updated Edition',
        pdfNotes: JSON.stringify([
          {
            title: 'Kent Lectures Chapter 1 PDF',
            url: mockPdfUrl,
            secure_url: mockPdfUrl,
            resource_type: 'raw',
          },
          {
            title: 'Miasms Supplementary Reading',
            url: mockSupplementaryPdfUrl,
            secure_url: mockSupplementaryPdfUrl,
            resource_type: 'raw',
          }
        ])
      },
      file: null,
      files: []
    };

    const mockResUpdate = createMockRes();
    await courseController.updateLesson(updateLessonReq, mockResUpdate);

    assert.strictEqual(mockResUpdate.statusCode, 200);
    const updatedLesson = mockResUpdate.data.data;
    assert.strictEqual(updatedLesson.pdfNotes.length, 2, 'Should have 2 PDF notes after update');
    assert.strictEqual(updatedLesson.pdfNotes[1].fileUrl, mockSupplementaryPdfUrl);
    assert.strictEqual(updatedLesson.pdfNotes[1].documentUrl, mockSupplementaryPdfUrl);
    assert.strictEqual(updatedLesson.pdfNotes[1].path, mockSupplementaryPdfUrl);
    console.log('✅ PASS: updateLesson persisted updated PDF notes without stripping metadata.');

    // ------------------------------------------------------------------
    // TEST 5: Verify GET /api/courses (Course Listing Endpoint)
    // ------------------------------------------------------------------
    console.log('\n--- TEST 5: Verify GET /api/courses Includes Full Document Metadata ---');
    const mockResCourses = createMockRes();
    await courseController.getCourses({}, mockResCourses);

    assert.strictEqual(mockResCourses.statusCode, 200);
    assert.ok(Array.isArray(mockResCourses.data.data));

    const retrievedCourse = mockResCourses.data.data.find(c => c._id.toString() === testCourse._id.toString() || c.courseId === testCourse.courseId);
    assert.ok(retrievedCourse, 'Test course must be returned by GET /api/courses');

    const retrievedModule = retrievedCourse.modules.find(m => m._id.toString() === moduleId);
    assert.ok(retrievedModule, 'Module must be returned inside course');

    const retrievedLesson = retrievedModule.lessons.find(l => l._id.toString() === lessonId);
    assert.ok(retrievedLesson, 'Lesson must be returned inside module');

    // Verify document URLs in GET /api/courses
    assert.ok(retrievedLesson.pdfNotes.length >= 2, 'pdfNotes must be present');
    for (const note of retrievedLesson.pdfNotes) {
      assert.ok(note.url && note.url.startsWith('https://'), `note.url must be valid HTTPS: ${note.url}`);
      assert.ok(note.secure_url && note.secure_url.startsWith('https://'), `note.secure_url must be valid HTTPS: ${note.secure_url}`);
      assert.ok(note.fileUrl && note.fileUrl.startsWith('https://'), `note.fileUrl must be valid HTTPS: ${note.fileUrl}`);
      assert.ok(note.documentUrl && note.documentUrl.startsWith('https://'), `note.documentUrl must be valid HTTPS: ${note.documentUrl}`);
      assert.ok(note.path && note.path.startsWith('https://'), `note.path must be valid HTTPS: ${note.path}`);
      assert.notStrictEqual(note.url, null);
    }

    assert.ok(retrievedLesson.attachments.length >= 1, 'attachments must be present');
    for (const att of retrievedLesson.attachments) {
      assert.ok(att.url && att.url.startsWith('https://'), `att.url must be valid HTTPS: ${att.url}`);
      assert.ok(att.secure_url && att.secure_url.startsWith('https://'), `att.secure_url must be valid HTTPS: ${att.secure_url}`);
      assert.ok(att.fileUrl && att.fileUrl.startsWith('https://'), `att.fileUrl must be valid HTTPS: ${att.fileUrl}`);
      assert.ok(att.documentUrl && att.documentUrl.startsWith('https://'), `att.documentUrl must be valid HTTPS: ${att.documentUrl}`);
      assert.ok(att.path && att.path.startsWith('https://'), `att.path must be valid HTTPS: ${att.path}`);
    }

    assert.ok(retrievedLesson.fileUrl && retrievedLesson.fileUrl.startsWith('https://'), 'Lesson-level fileUrl must not be null');
    assert.ok(retrievedLesson.documentUrl && retrievedLesson.documentUrl.startsWith('https://'), 'Lesson-level documentUrl must not be null');
    console.log('✅ PASS: GET /api/courses returns complete document metadata without stripping URLs!');

    // ------------------------------------------------------------------
    // TEST 6: Verify GET /api/courses/:courseId/modules (Module Retrieval Endpoint)
    // ------------------------------------------------------------------
    console.log('\n--- TEST 6: Verify GET /api/courses/:courseId/modules Includes Full Document Metadata ---');
    const mockResModules = createMockRes();
    await courseController.getModules({ params: { courseId: testCourse.courseId } }, mockResModules);

    assert.strictEqual(mockResModules.statusCode, 200);
    assert.ok(Array.isArray(mockResModules.data.data));

    const modItem = mockResModules.data.data.find(m => m._id.toString() === moduleId);
    assert.ok(modItem, 'Module must be returned by GET /api/courses/:courseId/modules');
    const modLesson = modItem.lessons.find(l => l._id.toString() === lessonId);
    assert.ok(modLesson, 'Lesson must be returned inside module');

    assert.ok(modLesson.pdfNotes[0].fileUrl.startsWith('https://'), 'PDF note fileUrl must be present in getModules');
    assert.ok(modLesson.pdfNotes[0].documentUrl.startsWith('https://'), 'PDF note documentUrl must be present in getModules');
    assert.ok(modLesson.attachments[0].fileUrl.startsWith('https://'), 'Attachment fileUrl must be present in getModules');
    assert.ok(modLesson.attachments[0].documentUrl.startsWith('https://'), 'Attachment documentUrl must be present in getModules');
    console.log('✅ PASS: GET /api/courses/:courseId/modules returns complete document metadata!');

    // ------------------------------------------------------------------
    // TEST 7: Verify GET /api/courses/:courseId/modules/:moduleId/lessons
    // ------------------------------------------------------------------
    console.log('\n--- TEST 7: Verify GET /api/courses/:courseId/modules/:moduleId/lessons ---');
    const mockResLessons = createMockRes();
    await courseController.getLessonsByModule(
      { params: { courseId: testCourse.courseId, moduleId: moduleId } },
      mockResLessons
    );

    assert.strictEqual(mockResLessons.statusCode, 200);
    const lessonsList = mockResLessons.data.data;
    assert.ok(Array.isArray(lessonsList));
    const targetLes = lessonsList.find(l => l._id.toString() === lessonId);
    assert.ok(targetLes);
    assert.ok(targetLes.pdfNotes[0].secure_url.startsWith('https://'));
    assert.ok(targetLes.pdfNotes[0].fileUrl.startsWith('https://'));
    assert.ok(targetLes.attachments[0].secure_url.startsWith('https://'));
    assert.ok(targetLes.attachments[0].fileUrl.startsWith('https://'));
    console.log('✅ PASS: GET /api/courses/:courseId/modules/:moduleId/lessons returns complete document metadata!');

    console.log('\n🎉 ALL DOCUMENT UPLOAD & RETRIEVAL VERIFICATION TESTS PASSED SUCCESSFULLY! 🚀');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exitCode = 1;
  } finally {
    console.log('\n🧹 Cleaning up test course...');
    if (testCourse) {
      await Course.findByIdAndDelete(testCourse._id);
      console.log('✅ Test course cleaned up.');
    }
    await mongoose.connection.close();
    console.log('👋 Database connection closed.');
  }
}

runTests();
