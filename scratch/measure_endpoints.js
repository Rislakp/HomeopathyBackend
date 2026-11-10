const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { getMyCourses, getMyCourseContent } = require('../controllers/studentCurriculumController');
const { getRecordings } = require('../controllers/recordingController');
const Course = require('../models/Course');
const Student = require('../models/Student');

// Mock req and res
function mockReqRes(user, params = {}, query = {}) {
  const req = { user, params, query, headers: {} };
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

async function testPerformance() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Find a student
  const student = await Student.findOne({ status: 'Active' }) || await Student.findOne({});
  console.log('Testing with student:', student.name, 'email:', student.email, 'ID:', student._id);

  const mockUser = {
    id: student._id.toString(),
    _id: student._id.toString(),
    email: student.email,
    role: 'student',
  };

  // 1. Measure getMyCourses
  console.log('\n--- Measuring getMyCourses ---');
  for (let i = 1; i <= 3; i++) {
    const { req, res, getStatus, getData } = mockReqRes(mockUser);
    const start = Date.now();
    await getMyCourses(req, res);
    const duration = Date.now() - start;
    const data = getData();
    console.log(`Run ${i}: status=${getStatus()}, time=${duration}ms, courses=${data?.data?.length}`);
  }

  // 2. Measure getMyCourseContent for COMBO COURSE
  console.log('\n--- Measuring getMyCourseContent (CRS-000070) ---');
  for (let i = 1; i <= 3; i++) {
    const { req, res, getStatus, getData } = mockReqRes(mockUser, { courseId: 'CRS-000070' });
    const start = Date.now();
    await getMyCourseContent(req, res);
    const duration = Date.now() - start;
    const data = getData();
    console.log(`Run ${i}: status=${getStatus()}, time=${duration}ms, modules=${data?.data?.modules?.length}`);
  }

  // 3. Measure getRecordings (live-records)
  console.log('\n--- Measuring getRecordings ---');
  for (let i = 1; i <= 3; i++) {
    const { req, res, getStatus, getData } = mockReqRes(mockUser);
    const start = Date.now();
    await getRecordings(req, res);
    const duration = Date.now() - start;
    const data = getData();
    console.log(`Run ${i}: status=${getStatus()}, time=${duration}ms, recordings=${data?.data?.length || data?.recordings?.length}`);
  }

  await mongoose.disconnect();
}

testPerformance();
