const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { getMyCourses } = require('../controllers/studentCurriculumController');
const Student = require('../models/Student');

async function checkMyCoursesSize() {
  await mongoose.connect(process.env.MONGODB_URI);
  const student = await Student.findOne({ courseId: 'CRS-000070' }) || await Student.findOne({ status: 'Active' });
  console.log('Testing student:', student.name, student.email);

  const req = {
    user: {
      id: student._id.toString(),
      _id: student._id.toString(),
      email: student.email,
      role: 'student',
      courseIds: [student.courseId, student.courseRef].filter(Boolean),
      courseId: student.courseId,
      course: student.course,
    },
    query: {},
    headers: {},
  };

  let responseData = null;
  const res = {
    status: () => res,
    json: (d) => { responseData = d; return res; },
  };

  const start = Date.now();
  await getMyCourses(req, res);
  const elapsed = Date.now() - start;

  const jsonStr = JSON.stringify(responseData);
  console.log(`getMyCourses took ${elapsed}ms`);
  console.log(`Payload size: ${(Buffer.byteLength(jsonStr) / 1024).toFixed(2)} KB`);
  console.log(`Courses count: ${responseData?.data?.length}`);

  if (responseData?.data?.[0]) {
    const c0 = responseData.data[0];
    console.log(`Course 0: ${c0.courseTitle}, modules: ${c0.modules?.length}`);
    let totalLessons = 0;
    let totalSignedUrls = 0;
    for (const m of c0.modules || []) {
      for (const l of m.lessons || []) {
        totalLessons++;
        if (l.videoUrl) totalSignedUrls++;
        if (l.pdfUrl) totalSignedUrls++;
        for (const vp of l.videoParts || []) { if (vp.url) totalSignedUrls++; }
        for (const pn of l.pdfNotes || []) { if (pn.url) totalSignedUrls++; }
      }
    }
    console.log(`  Total lessons in course 0: ${totalLessons}`);
    console.log(`  Total signed media URLs generated for course 0: ${totalSignedUrls}`);
  }

  await mongoose.disconnect();
}

checkMyCoursesSize();
