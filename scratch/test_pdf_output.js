const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../models/Course');
const { signS3Reference } = require('../utils/s3MediaSigner');
const studentCurriculumController = require('../controllers/studentCurriculumController');

async function testApiPdfOutput() {
  await mongoose.connect(process.env.MONGODB_URI);
  const course = await Course.findOne({ courseId: 'CRS-000070' }); // COMBO COURSE
  console.log('Course found:', course.courseTitle);

  // Let's see what a lesson's pdfNotes looks like in MongoDB vs after formatting
  for (const mod of course.modules || []) {
    for (const les of mod.lessons || []) {
      if (les.pdfNotes && les.pdfNotes.length > 0) {
        console.log(`\nLesson: "${les.lessonTitle}"`);
        console.log('Raw in DB:', JSON.stringify(les.pdfNotes, null, 2));
        console.log('les.pdfUrl:', les.pdfUrl);
        console.log('les.fileUrl:', les.fileUrl);
        console.log('les.documentUrl:', les.documentUrl);
        break;
      }
    }
  }

  await mongoose.disconnect();
}

testApiPdfOutput();
