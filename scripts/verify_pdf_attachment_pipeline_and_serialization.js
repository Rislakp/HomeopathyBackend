require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');
const { processUploadsToCloudinary } = require('../middleware/upload');
const { isCloudinaryConfigured, uploadBufferToCloudinary, cloudinary } = require('../config/cloudinary');

/**
 * Mock Express Response object for controller testing
 */
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

/**
 * Validates that all URL aliases in a resource object are populated, non-null, and valid HTTPS URLs.
 */
function assertResourceAliasesPopulated(resource, resourceName) {
  const aliases = ['fileUrl', 'url', 'secure_url', 'documentUrl', 'path'];
  for (const alias of aliases) {
    const val = resource[alias];
    assert.ok(
      val && typeof val === 'string' && val.trim().length > 0,
      `[${resourceName}] Alias '${alias}' must be non-null, non-empty string. Got: ${val}`
    );
    assert.ok(
      val.startsWith('https://') || val.startsWith('http://'),
      `[${resourceName}] Alias '${alias}' must be a valid HTTP(S) URL. Got: ${val}`
    );
  }
}

async function runComprehensiveVerification() {
  console.log('================================================════════════════════');
  console.log('  PDF & DOCUMENT ATTACHMENT PIPELINE AND SERIALIZATION TEST SUITE  ');
  console.log('================================================════════════════════\n');

  const timestamp = Date.now();
  const assetsToCleanup = [];

  // Connect to MongoDB
  const dbUri = process.env.USE_LOCAL_DB === 'true'
    ? process.env.MONGODB_LOCAL_URI
    : (process.env.MONGODB_URI || process.env.MONGO_URI);

  await mongoose.connect(dbUri);
  console.log(`✅ MongoDB Connected (${dbUri})`);

  let testCourse = null;

  try {
    // ------------------------------------------------------------------
    // SECTION 1: Cloudinary Upload Pipeline Test
    // ------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log('STAGE 1: Cloudinary Upload Pipeline Test (PDF & Document Attachments)');
    console.log('--------------------------------------------------------------------');

    assert.ok(isCloudinaryConfigured(), 'Cloudinary credentials must be configured in environment');
    console.log('✅ Cloudinary environment configured');

    // 1A. Test PDF Upload via uploadBufferToCloudinary
    const pdfContent = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\nxref\n0 4\n0000000000 65535 f \ntrailer << /Root 1 0 R /Size 4 >>\nstartxref\n150\n%%EOF';
    const samplePdfBuffer = Buffer.from(pdfContent, 'utf-8');

    const pdfFileObj = {
      fieldname: 'pdfNotes',
      originalname: `Organon_Lecture_${timestamp}.pdf`,
      mimetype: 'application/pdf',
      buffer: samplePdfBuffer,
    };

    console.log(`Uploading test PDF note: "${pdfFileObj.originalname}"...`);
    const pdfUploadRes = await uploadBufferToCloudinary(pdfFileObj, 'homeopathy-media/pdf-notes', {
      resource_type: 'raw',
      public_id: `organon_lecture_${timestamp}.pdf`,
    });

    assetsToCleanup.push({ public_id: pdfUploadRes.public_id, resource_type: 'raw' });

    console.log('Cloudinary PDF Upload Result:', {
      public_id: pdfUploadRes.public_id,
      resource_type: pdfUploadRes.resource_type,
      secure_url: pdfUploadRes.secure_url,
    });

    assert.strictEqual(pdfUploadRes.resource_type, 'raw', 'PDF uploads must use resource_type: "raw"');
    assert.ok(pdfUploadRes.public_id.endsWith('.pdf'), 'PDF public_id must retain .pdf extension');
    assert.ok(pdfUploadRes.secure_url.includes('/raw/upload/'), 'PDF secure_url must contain /raw/upload/');
    assert.ok(pdfUploadRes.secure_url.endsWith('.pdf'), 'PDF secure_url must retain .pdf extension');
    console.log('✅ PASS: PDF Note uploaded with resource_type: "raw" and preserved .pdf extension');

    // 1B. Test Non-PDF Document Attachment Upload (e.g. DOCX / CSV)
    const docxContent = 'Dummy document attachment content';
    const sampleDocBuffer = Buffer.from(docxContent, 'utf-8');
    const docFileObj = {
      fieldname: 'attachments',
      originalname: `Clinical_Symptom_Chart_${timestamp}.docx`,
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: sampleDocBuffer,
    };

    console.log(`Uploading test document attachment: "${docFileObj.originalname}"...`);
    const docUploadRes = await uploadBufferToCloudinary(docFileObj, 'homeopathy-media/attachments', {
      resource_type: 'raw',
      public_id: `clinical_symptom_chart_${timestamp}.docx`,
    });

    assetsToCleanup.push({ public_id: docUploadRes.public_id, resource_type: 'raw' });

    assert.strictEqual(docUploadRes.resource_type, 'raw', 'Document attachments must use resource_type: "raw"');
    assert.ok(docUploadRes.secure_url.includes('/raw/upload/'), 'Document attachment secure_url must contain /raw/upload/');
    console.log('✅ PASS: Document attachment uploaded with resource_type: "raw"');

    // 1C. Test processUploadsToCloudinary Middleware for PDF
    const reqMock = {
      file: pdfFileObj,
      files: [],
      body: {},
    };
    const resMock = createMockRes();
    let nextCalled = false;
    await processUploadsToCloudinary(reqMock, resMock, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'processUploadsToCloudinary should invoke next() on success');
    assert.ok(reqMock.file.secure_url, 'Middleware must attach secure_url to file');
    assert.strictEqual(reqMock.file.resource_type, 'raw', 'Middleware must assign resource_type "raw" for PDF');
    assert.strictEqual(reqMock.file.mimetype, 'application/pdf', 'Middleware must assign application/pdf mimetype');
    if (reqMock.file.public_id) {
      assetsToCleanup.push({ public_id: reqMock.file.public_id, resource_type: 'raw' });
    }
    console.log('✅ PASS: Upload middleware correctly processes raw PDF upload and assigns secure_url');

    // ------------------------------------------------------------------
    // SECTION 2: Database & Endpoint Serialization Verification
    // ------------------------------------------------------------------
    console.log('\n--------------------------------------------------------------------');
    console.log('STAGE 2: Database & Serialization Validation (GET /api/courses & GET /api/courses/:courseId/modules)');
    console.log('--------------------------------------------------------------------');

    const pdfUrl = pdfUploadRes.secure_url;
    const docUrl = docUploadRes.secure_url;
    const assignmentUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1726000099/homeopathy-media/assignments/case_study_assignment.pdf';

    console.log('Creating Test Course & Module in Database...');
    testCourse = await Course.create({
      courseId: `CRS-VERIFY-${timestamp}`,
      courseTitle: 'Comprehensive Organon & Homeopathic Philosophy',
      instructor: 'Dr. Samuel Hahnemann',
      price: 5000,
      modules: [
        {
          moduleName: 'Module 1: Principles of Cure',
          lessons: []
        }
      ]
    });

    const moduleId = testCourse.modules[0]._id.toString();

    console.log(`Adding Lesson with PDF notes, attachments, and assignments to Course ${testCourse.courseId}...`);
    const addLessonReq = {
      params: { courseId: testCourse.courseId, moduleId },
      body: {
        lessonTitle: 'Aphorism 1 to 10 - Primary Principles',
        lessonType: 'PDF Notes',
        durationOrPages: '18 pages',
        description: 'Analysis of health, disease, and cure',
        pdfNotes: JSON.stringify([
          {
            title: 'Aphorism 1-10 Notes PDF',
            url: pdfUrl,
            secure_url: pdfUrl,
            resource_type: 'raw',
            mimetype: 'application/pdf',
            size: samplePdfBuffer.length,
          }
        ]),
        attachments: JSON.stringify([
          {
            title: 'Symptom Classification Chart',
            url: docUrl,
            secure_url: docUrl,
            resource_type: 'raw',
            mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: sampleDocBuffer.length,
          }
        ]),
        assignments: JSON.stringify([
          {
            title: 'Case Study 1 Assignment',
            url: assignmentUrl,
            secure_url: assignmentUrl,
            resource_type: 'raw',
            mimetype: 'application/pdf',
            size: 2048576,
          }
        ]),
      },
      file: null,
      files: []
    };

    const mockResAdd = createMockRes();
    await courseController.addLesson(addLessonReq, mockResAdd);

    assert.strictEqual(mockResAdd.statusCode, 201, 'addLesson should return 201 Created');
    const addedLesson = mockResAdd.data.data;
    const lessonId = addedLesson._id.toString();

    console.log(`✅ Lesson created successfully (_id: ${lessonId})`);

    // 2A. Check GET /api/courses Response
    console.log('\nChecking GET /api/courses response serialization...');
    const mockResGetCourses = createMockRes();
    await courseController.getCourses({}, mockResGetCourses);

    assert.strictEqual(mockResGetCourses.statusCode, 200, 'GET /api/courses must return 200 OK');
    const coursesList = mockResGetCourses.data.courses || mockResGetCourses.data.data;
    assert.ok(Array.isArray(coursesList), 'Courses response must be an array');

    const fetchedCourse = coursesList.find(c => c._id.toString() === testCourse._id.toString() || c.courseId === testCourse.courseId);
    assert.ok(fetchedCourse, 'Fetched course list must contain the test course');

    const fetchedModule = fetchedCourse.modules.find(m => m._id.toString() === moduleId);
    assert.ok(fetchedModule, 'Fetched course must contain the test module');

    const fetchedLesson = fetchedModule.lessons.find(l => l._id.toString() === lessonId);
    assert.ok(fetchedLesson, 'Fetched module must contain the test lesson');

    // Verify pdfNotes aliases in GET /api/courses
    assert.ok(fetchedLesson.pdfNotes.length >= 1, 'pdfNotes array must contain at least 1 item');
    for (const note of fetchedLesson.pdfNotes) {
      assertResourceAliasesPopulated(note, 'GET /api/courses -> pdfNotes item');
      assert.strictEqual(note.fileUrl, pdfUrl, 'note.fileUrl must match secure_url');
      assert.strictEqual(note.documentUrl, pdfUrl, 'note.documentUrl must match secure_url');
      assert.strictEqual(note.path, pdfUrl, 'note.path must match secure_url');
    }

    // Verify attachments aliases in GET /api/courses
    assert.ok(fetchedLesson.attachments.length >= 1, 'attachments array must contain at least 1 item');
    for (const att of fetchedLesson.attachments) {
      assertResourceAliasesPopulated(att, 'GET /api/courses -> attachments item');
      assert.strictEqual(att.fileUrl, docUrl, 'attachment.fileUrl must match secure_url');
      assert.strictEqual(att.documentUrl, docUrl, 'attachment.documentUrl must match secure_url');
      assert.strictEqual(att.path, docUrl, 'attachment.path must match secure_url');
    }

    // Verify assignments aliases in GET /api/courses
    assert.ok(fetchedLesson.assignments.length >= 1, 'assignments array must contain at least 1 item');
    for (const asgn of fetchedLesson.assignments) {
      assertResourceAliasesPopulated(asgn, 'GET /api/courses -> assignments item');
      assert.strictEqual(asgn.fileUrl, assignmentUrl, 'assignment.fileUrl must match secure_url');
      assert.strictEqual(asgn.documentUrl, assignmentUrl, 'assignment.documentUrl must match secure_url');
      assert.strictEqual(asgn.path, assignmentUrl, 'assignment.path must match secure_url');
    }

    // Verify lesson top-level URL fields
    assert.ok(fetchedLesson.fileUrl && fetchedLesson.fileUrl === pdfUrl, 'Lesson-level fileUrl must equal primary PDF URL');
    assert.ok(fetchedLesson.documentUrl && fetchedLesson.documentUrl === pdfUrl, 'Lesson-level documentUrl must equal primary PDF URL');
    assert.ok(fetchedLesson.pdfUrl && fetchedLesson.pdfUrl === pdfUrl, 'Lesson-level pdfUrl must equal primary PDF URL');
    assert.ok(fetchedLesson.path && fetchedLesson.path === pdfUrl, 'Lesson-level path must equal primary PDF URL');
    assert.ok(fetchedLesson.url && fetchedLesson.url === pdfUrl, 'Lesson-level url must equal primary PDF URL');

    console.log('✅ PASS: GET /api/courses exposes fully populated URL aliases (fileUrl, url, secure_url, documentUrl, path)');

    // 2B. Check GET /api/courses/:courseId/modules Response
    console.log('\nChecking GET /api/courses/:courseId/modules response serialization...');
    const mockResGetModules = createMockRes();
    await courseController.getModules({ params: { courseId: testCourse.courseId } }, mockResGetModules);

    assert.strictEqual(mockResGetModules.statusCode, 200, 'GET /api/courses/:courseId/modules must return 200 OK');
    const modulesList = mockResGetModules.data.data || mockResGetModules.data;
    assert.ok(Array.isArray(modulesList), 'Modules response must be an array');

    const modItem = modulesList.find(m => m._id.toString() === moduleId);
    assert.ok(modItem, 'Modules response must contain the test module');

    const modLesson = modItem.lessons.find(l => l._id.toString() === lessonId);
    assert.ok(modLesson, 'Module lessons must contain the test lesson');

    // Verify pdfNotes aliases in GET /api/courses/:courseId/modules
    for (const note of modLesson.pdfNotes) {
      assertResourceAliasesPopulated(note, 'GET /api/courses/:courseId/modules -> pdfNotes item');
    }

    // Verify attachments aliases in GET /api/courses/:courseId/modules
    for (const att of modLesson.attachments) {
      assertResourceAliasesPopulated(att, 'GET /api/courses/:courseId/modules -> attachments item');
    }

    // Verify assignments aliases in GET /api/courses/:courseId/modules
    for (const asgn of modLesson.assignments) {
      assertResourceAliasesPopulated(asgn, 'GET /api/courses/:courseId/modules -> assignments item');
    }

    console.log('✅ PASS: GET /api/courses/:courseId/modules exposes fully populated URL aliases (fileUrl, url, secure_url, documentUrl, path)');

    console.log('\n====================================================================');
    console.log('🎉 ALL PDF & DOCUMENT ATTACHMENT VERIFICATION TESTS PASSED SUCCESSFULLY! 🚀');
    console.log('====================================================================\n');

  } catch (err) {
    console.error('❌ Verification failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup temporary test assets from Cloudinary
    if (assetsToCleanup.length > 0) {
      console.log(`Cleaning up ${assetsToCleanup.length} temporary Cloudinary test assets...`);
      for (const asset of assetsToCleanup) {
        try {
          await cloudinary.uploader.destroy(asset.public_id, { resource_type: asset.resource_type });
          console.log(`  - Deleted [${asset.resource_type}] ${asset.public_id}`);
        } catch (delErr) {
          console.warn(`  - Could not delete asset ${asset.public_id}: ${delErr.message}`);
        }
      }
    }

    // Cleanup test course from MongoDB
    if (testCourse) {
      console.log('Cleaning up test course from database...');
      await Course.findByIdAndDelete(testCourse._id);
      console.log('  - Test course removed.');
    }

    await mongoose.connection.close();
    console.log('👋 MongoDB Connection Closed.\n');
  }
}

runComprehensiveVerification();
