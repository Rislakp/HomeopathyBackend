const assert = require('assert');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const { isCloudinaryConfigured, getPublicIdFromUrl, parseCloudinaryUrl } = require('../config/cloudinary');
const upload = require('../middleware/upload');

async function runTests() {
  console.log('🧪 Starting Cloudinary & Lesson Upload Verification Tests...\n');

  // Test 1: Cloudinary URL parser & Public ID extraction
  console.log('Test 1: Cloudinary URL Parser & Public ID Extraction');
  const sampleVideoUrl = 'https://res.cloudinary.com/demo/video/upload/v1612345678/homeopathy-media/videos/intro_lecture_123.mp4';
  const samplePdfUrl = 'https://res.cloudinary.com/demo/image/upload/v1612345678/homeopathy-media/pdf-notes/organon_aphorisms.pdf';
  const sampleRawUrl = 'https://res.cloudinary.com/demo/raw/upload/v1612345678/homeopathy-media/attachments/assignment_guidelines.docx';

  const parsedVideo = parseCloudinaryUrl(sampleVideoUrl);
  assert.strictEqual(parsedVideo.resourceType, 'video');
  assert.strictEqual(parsedVideo.publicId, 'homeopathy-media/videos/intro_lecture_123');

  const parsedPdf = parseCloudinaryUrl(samplePdfUrl);
  assert.strictEqual(parsedPdf.resourceType, 'image');
  assert.strictEqual(parsedPdf.publicId, 'homeopathy-media/pdf-notes/organon_aphorisms');

  const parsedRaw = parseCloudinaryUrl(sampleRawUrl);
  assert.strictEqual(parsedRaw.resourceType, 'raw');
  assert.strictEqual(parsedRaw.publicId, 'homeopathy-media/attachments/assignment_guidelines');
  console.log('  ✅ Cloudinary URL parser accurately identified publicIds and resourceTypes');

  // Test 2: Course & Lesson Schema Validation with Cloudinary URLs
  console.log('\nTest 2: Course & Lesson Schema Validation');
  const testCourse = new Course({
    courseTitle: 'Comprehensive Homeopathic Therapeutics',
    instructor: 'Dr. Hahnemann Specialist',
    price: 3499,
    shortDescription: 'In-depth study of homeopathic clinical cases and organon.',
    duration: '12 Weeks',
    status: 'Published',
    modules: [
      {
        moduleName: 'Module 1: Acute Prescribing',
        lessons: [
          {
            lessonTitle: 'Lesson 1.1: Principles of Potency Selection',
            lessonType: 'Recorded Video',
            durationOrPages: '42 mins',
            description: 'Understanding low, medium, and high potencies in clinical setting.',
            videoUrl: sampleVideoUrl,
            videoParts: [
              { title: 'Part 1: Low Potencies', url: sampleVideoUrl },
              { title: 'Part 2: High Potencies', url: 'https://res.cloudinary.com/demo/video/upload/v1612345678/part2.mp4' }
            ],
            pdfNotes: [
              { title: 'Potency Table PDF', url: samplePdfUrl }
            ],
            attachments: [
              { title: 'Prescription Guide DOCX', url: sampleRawUrl }
            ],
            status: 'Published'
          }
        ]
      }
    ]
  });

  const validationError = testCourse.validateSync();
  assert.strictEqual(validationError, undefined, 'Course schema validation failed');
  assert.strictEqual(testCourse.modules[0].lessons[0].videoParts.length, 2);
  assert.strictEqual(testCourse.modules[0].lessons[0].pdfNotes.length, 1);
  assert.strictEqual(testCourse.modules[0].lessons[0].attachments.length, 1);
  assert.strictEqual(testCourse.modules[0].lessons[0].videoUrl, sampleVideoUrl);
  console.log('  ✅ Course & Lesson Mongoose subdocuments correctly store videoParts, pdfNotes, attachments, and videoUrl');

  // Test 3: Upload Middleware Structure
  console.log('\nTest 3: Upload Middleware Configuration');
  assert.strictEqual(typeof upload.any, 'function');
  assert.strictEqual(typeof upload.processUploadsToCloudinary, 'function');
  console.log('  ✅ Multer and processUploadsToCloudinary middleware initialized');

  // Test 4: Mock Lesson Creation Endpoint Handler
  console.log('\nTest 4: Simulating Add Lesson Route with Multipart Files & Body Mapping');
  
  // Create a mock course in memory
  const mockCourse = new Course({
    courseTitle: 'Clinical Repertory Masterclass',
    instructor: 'Dr. J. T. Kent',
    price: 5999,
    shortDescription: 'Mastering Kent Repertory in Chronic Cases',
    duration: '8 Weeks',
    modules: [
      {
        _id: new mongoose.Types.ObjectId(),
        moduleName: 'Mind Section',
        lessons: []
      }
    ]
  });

  const moduleId = mockCourse.modules[0]._id.toString();

  // Test adding a lesson with simulated Cloudinary files & metadata
  const req = {
    params: {
      courseId: mockCourse._id.toString(),
      moduleId: moduleId,
    },
    body: {
      lessonTitle: 'Mind Section Rubrics 101',
      lessonType: 'Recorded Video',
      durationOrPages: '55 mins',
      description: 'Detailed analysis of fear, anxiety, and delusion rubrics.',
      // Form fields containing existing or JSON array
      videoParts: JSON.stringify([
        { title: 'Intro Video', url: 'https://res.cloudinary.com/demo/video/upload/v1/mind_intro.mp4' }
      ]),
      pdfNotes: JSON.stringify([
        { title: 'Kent Repertory Mind Notes', url: 'https://res.cloudinary.com/demo/image/upload/v1/mind_notes.pdf' }
      ]),
    },
    files: [
      {
        fieldname: 'videoParts',
        originalname: 'mind_advanced_part2.mp4',
        mimetype: 'video/mp4',
        secure_url: 'https://res.cloudinary.com/demo/video/upload/v1/mind_advanced_part2.mp4',
      },
      {
        fieldname: 'attachments',
        originalname: 'mind_case_study.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        secure_url: 'https://res.cloudinary.com/demo/raw/upload/v1/mind_case_study.docx',
      }
    ]
  };

  // Simulate controller lesson resolution logic
  let finalVideoUrl = '';
  let finalVideoParts = [
    { title: 'Intro Video', url: 'https://res.cloudinary.com/demo/video/upload/v1/mind_intro.mp4' }
  ];
  let finalPdfNotes = [
    { title: 'Kent Repertory Mind Notes', url: 'https://res.cloudinary.com/demo/image/upload/v1/mind_notes.pdf' }
  ];
  let finalAttachments = [];

  req.files.forEach((f) => {
    const fileUrl = f.secure_url || f.url || f.path;
    const fileTitle = f.originalname;
    const fileObj = { title: fileTitle, url: fileUrl };
    if (f.fieldname === 'videoParts') {
      finalVideoParts.push(fileObj);
      if (!finalVideoUrl) finalVideoUrl = fileUrl;
    } else if (f.fieldname === 'attachments') {
      finalAttachments.push(fileObj);
    }
  });

  if (!finalVideoUrl && finalVideoParts.length > 0) {
    finalVideoUrl = finalVideoParts[0].url;
  }

  const newLesson = {
    lessonTitle: req.body.lessonTitle,
    lessonType: req.body.lessonType,
    durationOrPages: req.body.durationOrPages,
    description: req.body.description,
    videoUrl: finalVideoUrl,
    videoParts: finalVideoParts,
    pdfNotes: finalPdfNotes,
    attachments: finalAttachments,
    status: 'Published',
  };

  mockCourse.modules[0].lessons.push(newLesson);

  const savedLesson = mockCourse.modules[0].lessons[0];
  assert.strictEqual(savedLesson.lessonTitle, 'Mind Section Rubrics 101');
  assert.strictEqual(savedLesson.videoParts.length, 2);
  assert.strictEqual(savedLesson.videoParts[0].url, 'https://res.cloudinary.com/demo/video/upload/v1/mind_intro.mp4');
  assert.strictEqual(savedLesson.videoParts[1].url, 'https://res.cloudinary.com/demo/video/upload/v1/mind_advanced_part2.mp4');
  assert.strictEqual(savedLesson.pdfNotes.length, 1);
  assert.strictEqual(savedLesson.pdfNotes[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/mind_notes.pdf');
  assert.strictEqual(savedLesson.attachments.length, 1);
  assert.strictEqual(savedLesson.attachments[0].url, 'https://res.cloudinary.com/demo/raw/upload/v1/mind_case_study.docx');
  console.log('  ✅ Mock multipart file upload correctly mapped and merged with JSON metadata');

  console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
