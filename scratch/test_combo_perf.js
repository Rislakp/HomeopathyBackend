const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { getMyCourses } = require('../controllers/studentCurriculumController');
const Student = require('../models/Student');
const Course = require('../models/Course');

async function testComboStudent() {
  await mongoose.connect(process.env.MONGODB_URI);
  const combo = await Course.findOne({ courseId: 'CRS-000070' });
  const student = await Student.findOne({
    $or: [
      { courseId: 'CRS-000070' },
      { course: 'COMBO COURSE' },
      { courseIds: 'CRS-000070' },
      { courseIds: combo._id.toString() },
      { courseRef: combo._id },
    ],
  });

  console.log('Combo student:', student?.name, student?.email);

  if (!student) {
    console.log('No student found directly with COMBO COURSE, checking all students...');
    const students = await Student.find({}).limit(5).lean();
    students.forEach(s => console.log(s.name, s.course, s.courseId, s.courseIds));
    await mongoose.disconnect();
    return;
  }

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
  console.log(`getMyCourses for Combo student took ${elapsed}ms`);
  console.log(`Payload size: ${(Buffer.byteLength(jsonStr) / 1024).toFixed(2)} KB`);

  await mongoose.disconnect();
}

testComboStudent();
