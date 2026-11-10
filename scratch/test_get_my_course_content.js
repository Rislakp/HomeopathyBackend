const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.data = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Find a student enrolled in CRS-000041 or 6aab7f3954d18fda4f673a0d
  const Student = require('../models/Student');
  const student = await Student.findOne({
    $or: [
      { course: /KPSC/i },
      { courseId: 'CRS-000041' },
      { 'enrolledCourses.courseId': 'CRS-000041' },
      { _id: new mongoose.Types.ObjectId('6ac24de6017cf745d8b5c517') },
    ]
  }).lean();

  console.log('Found Student:', student ? { _id: student._id, name: student.name, course: student.course } : null);

  const req = {
    params: { courseId: 'CRS-000041' },
    user: {
      id: student._id.toString(),
      _id: student._id.toString(),
      role: 'student',
      courseId: 'CRS-000041',
    },
    headers: { host: 'localhost:5000' },
    protocol: 'http',
  };

  const res = createMockRes();
  await getMyCourseContent(req, res);

  console.log('getMyCourseContent response status:', res.statusCode);
  if (res.data && res.data.data) {
    const course = res.data.data;
    console.log('Course title:', course.courseTitle);
    for (const m of (course.modules || [])) {
      for (const l of (m.lessons || [])) {
        if (l.lessonTitle && l.lessonTitle.toLowerCase().includes('part 5')) {
          console.log('\n--- PART 5 Lesson Data ---');
          console.log('lessonTitle:', l.lessonTitle);
          console.log('videoUrl prefix:', l.videoUrl ? l.videoUrl.split('?')[0] : null);
          console.log('videoUrl query keys:', l.videoUrl ? Array.from(new URL(l.videoUrl).searchParams.keys()) : null);
          console.log('progress:', l.progress);
          console.log('videoParts:', (l.videoParts || []).map(vp => ({
            title: vp.title,
            urlPrefix: vp.url ? vp.url.split('?')[0] : null,
            queryParams: vp.url ? Array.from(new URL(vp.url).searchParams.keys()) : null,
          })));
        }
      }
    }
  } else {
    console.log('Response data:', res.data);
  }

  process.exit(0);
}

run();

