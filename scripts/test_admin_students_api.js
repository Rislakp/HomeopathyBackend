require('dotenv').config();
const http = require('http');
const express = require('cors');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Exam = require('../models/exam.model');
const TestResult = require('../src/common/models/testResult.model');

// Express App for test
const expressApp = require('express')();
const cors = require('cors');
expressApp.use(cors());
expressApp.use(require('express').json());

const adminRoutes = require('../routes/adminRoutes');
expressApp.use('/api/v1/admin', adminRoutes);
expressApp.use('/api/admin', adminRoutes);
expressApp.use('/api/v1/students', adminRoutes);
expressApp.use('/api/students', adminRoutes);

// Global error handler
expressApp.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, message: err.message });
});

let server;
let serverPort = 5055;

function makeRequest(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: serverPort,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING PUBLIC STUDENTS API VERIFICATION TESTS');
  console.log('====================================================\n');

  await connectDB();

  // Start temporary test server
  await new Promise((resolve) => {
    server = expressApp.listen(serverPort, () => {
      console.log(`📡 Test Server listening on http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });

  const timestamp = Date.now();

  try {
    console.log('📝 Setting up test data (Students, Course, Exam, Test Results)...');

    const studentUser = await User.create({
      name: `Public Test Student ${timestamp}`,
      email: `public_student_${timestamp}@example.com`,
      password: 'Password123!',
      role: 'student',
      contactNumber: `98000${timestamp.toString().slice(-5)}`,
      dateOfBirth: '2001-05-15',
      qualification: 'BHMS Doctor'
    });

    const course = await Course.create({
      courseId: `CRS-${timestamp.toString().slice(-6)}`,
      courseTitle: `Materia Medica Masterclass ${timestamp}`,
      instructor: 'Dr. Boericke',
      category: 'Homeopathy',
      price: 3499
    });

    const exam1 = await Exam.create({
      title: `Organon Mock Test ${timestamp}`,
      marksPerQuestion: 2,
      durationMinutes: 30,
      totalQuestions: 10,
      questions: [
        {
          questionText: 'What is the law of similars?',
          options: { A: 'Similia Similibus Curentur', B: 'Opposites Cure', C: 'Like cure unlike', D: 'None' },
          correctOption: 'A'
        }
      ]
    });

    const studentDoc1 = await Student.create({
      userId: studentUser._id,
      name: studentUser.name,
      email: studentUser.email,
      phone: studentUser.contactNumber,
      contactNumber: studentUser.contactNumber,
      dateOfBirth: studentUser.dateOfBirth,
      qualification: studentUser.qualification,
      course: course.courseTitle,
      subscription: 'VIP',
      status: 'Active',
      joinedDate: new Date()
    });

    const studentDoc2 = await Student.create({
      name: `Trial Open Student ${timestamp}`,
      email: `trial_open_${timestamp}@example.com`,
      phone: `97000${timestamp.toString().slice(-5)}`,
      course: course.courseTitle,
      subscription: 'Trial',
      status: 'Trial',
      joinedDate: new Date()
    });

    const studentDoc3 = await Student.create({
      name: `Expired Open Student ${timestamp}`,
      email: `expired_open_${timestamp}@example.com`,
      phone: `96000${timestamp.toString().slice(-5)}`,
      course: 'General',
      subscription: 'Basic',
      status: 'Expired',
      joinedDate: new Date()
    });

    // Score: 18 / 20 -> 90% Passed
    await TestResult.create({
      studentId: studentUser._id,
      examId: exam1._id,
      score: 18,
      totalMarks: 20,
      totalAttempted: 10,
      totalCorrect: 9,
      totalWrong: 1,
      status: 'Completed'
    });

    console.log('✅ Test Data Created successfully.\n');

    let testsPassed = 0;
    let testsFailed = 0;

    function assert(name, condition, details = '') {
      if (condition) {
        console.log(`  ✅ PASS: ${name}`);
        testsPassed++;
      } else {
        console.error(`  ❌ FAIL: ${name}`);
        if (details) console.error(`     Details: ${details}`);
        testsFailed++;
      }
    }

    // TEST 1: Public access without any Authorization header on /api/v1/admin/students
    console.log('--- Test 1: Public Access on /api/v1/admin/students ---');
    const res1 = await makeRequest('/api/v1/admin/students');
    assert('Returns 200 OK without Authorization header', res1.status === 200);
    assert('Returns success: true', res1.data.success === true);
    assert('Returns students array', Array.isArray(res1.data.data.students));
    assert('Returns pagination metadata', res1.data.data.pagination && res1.data.data.pagination.total >= 3);

    // TEST 2: Route aliases check (/api/v1/students, /api/admin/students, /api/students)
    console.log('\n--- Test 2: Route Aliases ---');
    const resV1Students = await makeRequest('/api/v1/students');
    assert('GET /api/v1/students returns 200', resV1Students.status === 200);

    const resAdminStudents = await makeRequest('/api/admin/students');
    assert('GET /api/admin/students returns 200', resAdminStudents.status === 200);

    const resStudents = await makeRequest('/api/students');
    assert('GET /api/students returns 200', resStudents.status === 200);

    // TEST 3: Attended Exams and Scores Structure
    console.log('\n--- Test 3: Attended Exams & Data Shape ---');
    const searchRes = await makeRequest(`/api/v1/admin/students?search=${encodeURIComponent(studentUser.email)}`);
    assert('Search by email returns 200', searchRes.status === 200);
    assert('Found single filtered student', searchRes.data.data.students.length === 1);

    const studentItem = searchRes.data.data.students[0];
    assert('Student matches email and name', studentItem.email === studentUser.email && studentItem.name === studentUser.name);
    assert('Student has phone and qualification', !!studentItem.phone && studentItem.qualification === 'BHMS Doctor');
    assert('Student has enrolled course', studentItem.enrolled_course.title === course.courseTitle);
    assert('Student has subscription VIP / Active', studentItem.subscription.status === 'Active' && studentItem.subscription.type === 'VIP');
    assert('Student has attended_exams array length 1', studentItem.attended_exams.length === 1);

    const examItem = studentItem.attended_exams[0];
    assert('Exam score 18/20, percentage 90%, status Passed', examItem.score === 18 && examItem.total_marks === 20 && examItem.percentage === 90 && examItem.status === 'Passed');

    // TEST 4: Search Filter (name/phone)
    console.log('\n--- Test 4: Search Filter ---');
    const searchNameRes = await makeRequest(`/api/v1/admin/students?search=${encodeURIComponent('Trial Open Student')}`);
    assert('Search by name returns matching student', searchNameRes.data.data.students.some(s => s.email === studentDoc2.email));

    // TEST 5: Status Filter
    console.log('\n--- Test 5: Status Filter ---');
    const statusTrialRes = await makeRequest('/api/v1/admin/students?status=Trial');
    assert('Status=Trial returns trial student', statusTrialRes.data.data.students.every(s => s.subscription.status.toLowerCase() === 'trial'));

    const statusExpiredRes = await makeRequest('/api/v1/admin/students?status=Expired');
    assert('Status=Expired returns expired student', statusExpiredRes.data.data.students.every(s => s.subscription.status.toLowerCase() === 'expired'));

    // TEST 6: Course Filter
    console.log('\n--- Test 6: Course Filter ---');
    const courseRes = await makeRequest(`/api/v1/admin/students?course=${encodeURIComponent(course.courseTitle)}`);
    assert('Course filter returns matching students', courseRes.data.data.students.every(s => s.enrolled_course.title === course.courseTitle));

    // TEST 7: Pagination Controls
    console.log('\n--- Test 7: Pagination Controls ---');
    const pageRes = await makeRequest('/api/v1/admin/students?page=1&limit=2');
    assert('Limit 2 returns at most 2 students', pageRes.data.data.students.length <= 2);
    assert('Pagination metadata limit is 2', pageRes.data.data.pagination.limit === 2);

    // TEST 8: Individual Student Lookup
    console.log('\n--- Test 8: Individual Student Lookup (GET /api/v1/admin/students/:id & /api/v1/students/:id) ---');
    const singleAdminRes = await makeRequest(`/api/v1/admin/students/${studentDoc1._id}`);
    assert('GET /api/v1/admin/students/:id returns 200', singleAdminRes.status === 200);
    assert('Single student data matches email and exam count', singleAdminRes.data.data.email === studentDoc1.email && singleAdminRes.data.data.attended_exams.length === 1);

    const singleStudentRes = await makeRequest(`/api/v1/students/${studentDoc1._id}`);
    assert('GET /api/v1/students/:id returns 200', singleStudentRes.status === 200);

    // Clean up
    console.log('\n🧹 Cleaning up test data...');
    await User.deleteOne({ _id: studentUser._id });
    await Student.deleteMany({ _id: { $in: [studentDoc1._id, studentDoc2._id, studentDoc3._id] } });
    await Course.deleteOne({ _id: course._id });
    await Exam.deleteOne({ _id: exam1._id });
    await TestResult.deleteOne({ studentId: studentUser._id });

    console.log('\n====================================================');
    console.log(`📊 TEST SUMMARY: Passed: ${testsPassed}, Failed: ${testsFailed}`);
    console.log('====================================================');

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Test execution error:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

runTests();
