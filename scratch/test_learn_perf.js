const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');
const Student = require('../models/Student');

async function testLearnContent() {
  await mongoose.connect(process.env.MONGODB_URI);
  const student = await Student.findOne({ email: 'geenameringeojo@gmail.com' });

  const req = {
    user: {
      id: student._id.toString(),
      _id: student._id.toString(),
      email: student.email,
      role: 'student',
      courseIds: Array.isArray(student.courseIds) ? student.courseIds : [student.courseId].filter(Boolean),
      courseId: student.courseId,
      course: student.course,
    },
    params: { courseId: 'CRS-000070' },
    query: {},
    headers: {},
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status: (code) => { statusCode = code; return res; },
    json: (d) => { responseData = d; return res; },
  };

  const start = Date.now();
  await getMyCourseContent(req, res);
  const elapsed = Date.now() - start;

  const jsonStr = JSON.stringify(responseData);
  console.log(`getMyCourseContent status: ${statusCode}, took ${elapsed}ms`);
  console.log(`Payload size: ${(Buffer.byteLength(jsonStr) / 1024).toFixed(2)} KB`);
  const course = responseData?.data?.course;
  console.log(`Course title: ${course?.courseTitle}, modules: ${course?.modules?.length}`);

  let totalSigned = 0;
  let samplePdfUrl = null;
  let sampleVideoUrl = null;

  for (const mod of course?.modules || []) {
    for (const les of mod.lessons || []) {
      if (les.videoUrl && les.videoUrl.startsWith('https://')) {
        totalSigned++;
        if (!sampleVideoUrl) sampleVideoUrl = les.videoUrl;
      }
      if (les.pdfUrl && les.pdfUrl.startsWith('https://')) {
        totalSigned++;
        if (!samplePdfUrl) samplePdfUrl = les.pdfUrl;
      }
      for (const cat of ['videoParts', 'pdfNotes', 'assignments', 'attachments']) {
        for (const item of les[cat] || []) {
          if (item.url && item.url.startsWith('https://')) {
            totalSigned++;
            if (cat === 'pdfNotes' && !samplePdfUrl) samplePdfUrl = item.url;
            if (cat === 'videoParts' && !sampleVideoUrl) sampleVideoUrl = item.url;
          }
        }
      }
    }
  }
  console.log(`Total signed media URLs generated in course learn: ${totalSigned}`);

  if (samplePdfUrl) {
    const parsed = new URL(samplePdfUrl);
    console.log('\nSample PDF signed URL params:');
    console.log('Host:', parsed.hostname);
    console.log('Expires (X-Amz-Expires):', parsed.searchParams.get('X-Amz-Expires'), 'seconds');
    console.log('ResponseContentType:', parsed.searchParams.get('response-content-type'));
    console.log('ResponseContentDisposition:', parsed.searchParams.get('response-content-disposition'));
  }

  if (sampleVideoUrl) {
    const parsed = new URL(sampleVideoUrl);
    console.log('\nSample Video signed URL params:');
    console.log('Host:', parsed.hostname);
    console.log('Expires (X-Amz-Expires):', parsed.searchParams.get('X-Amz-Expires'), 'seconds');
    console.log('ResponseContentType:', parsed.searchParams.get('response-content-type'));
    console.log('ResponseContentDisposition:', parsed.searchParams.get('response-content-disposition'));
  }

  await mongoose.disconnect();
}

testLearnContent();
