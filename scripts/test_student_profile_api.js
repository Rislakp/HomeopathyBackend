require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const User = require('../models/User');
const Student = require('../models/Student');
const studentController = require('../src/student/student.controller');
const { getJwtSecret } = require('../middleware/rbac');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runTests() {
  await connectDB();
  console.log('--- STARTING STUDENT PROFILE API TESTS ---');

  const testEmail = `test_student_${Date.now()}@example.com`;
  const testPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;

  // Create User
  const user = await User.create({
    name: 'Samiya Test',
    email: testEmail,
    password: 'password123',
    role: 'student',
    dateOfBirth: '01/01/2000',
    contactNumber: testPhone,
    phone: testPhone,
    qualification: 'PG'
  });

  // Create Student
  const student = await Student.create({
    userId: user._id,
    name: 'Samiya Test',
    email: testEmail,
    dateOfBirth: '01/01/2000',
    contactNumber: testPhone,
    phone: testPhone,
    qualification: 'PG',
    course: 'General',
    subscription: 'Free',
    status: 'Active',
    profileImage: ''
  });

  console.log(`Created test user: ${user._id} and student: ${student._id}`);

  // Test 1: Fetch student profile with valid student session
  console.log('\n[Test 1] Fetch student profile for authenticated student');
  {
    const req = {
      user: {
        id: user._id.toString(),
        userId: user._id.toString(),
        email: testEmail,
        name: 'Samiya Test',
        role: 'student'
      }
    };
    const res = mockRes();
    await studentController.getStudentProfile(req, res);

    console.log(`Status: ${res.statusCode}`);
    console.log('Response Body:', JSON.stringify(res.body, null, 2));

    const d = res.body?.data;
    if (
      res.statusCode === 200 &&
      res.body?.success === true &&
      d?.name === 'Samiya Test' &&
      d?.email === testEmail &&
      d?.contactNumber === testPhone &&
      d?.dateOfBirth === '01/01/2000' &&
      d?.qualification === 'PG' &&
      d?.course === 'General' &&
      d?.subscription === 'Free' &&
      d?.status === 'Active' &&
      res.body.password === undefined &&
      d?.password === undefined
    ) {
      console.log('✅ PASS: Profile returned all expected fields without passwords');
    } else {
      console.error('❌ FAIL: Profile fields mismatch');
    }
  }

  // Test 2: Fetch student profile with student document ID in session
  console.log('\n[Test 2] Fetch student profile using student document ID in session');
  {
    const req = {
      user: {
        id: student._id.toString(),
        userId: student._id.toString(),
        email: testEmail,
        name: 'Samiya Test',
        role: 'student'
      }
    };
    const res = mockRes();
    await studentController.getStudentProfile(req, res);

    console.log(`Status: ${res.statusCode}`);
    if (res.statusCode === 200 && res.body?.data?.email === testEmail) {
      console.log('✅ PASS: Student lookup by student._id works cleanly');
    } else {
      console.error('❌ FAIL: Failed to lookup by student._id', res.body);
    }
  }

  // Test 3: Non-existent student returns 404
  console.log('\n[Test 3] Non-existent student ID returns 404');
  {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const req = {
      user: {
        id: fakeId,
        userId: fakeId,
        role: 'student'
      }
    };
    const res = mockRes();
    await studentController.getStudentProfile(req, res);

    console.log(`Status: ${res.statusCode}, Message: ${res.body?.message}`);
    if (res.statusCode === 404) {
      console.log('✅ PASS: Non-existent student correctly returns 404');
    } else {
      console.error('❌ FAIL: Expected 404 for missing student', res.body);
    }
  }

  // Clean up
  await User.findByIdAndDelete(user._id);
  await Student.findByIdAndDelete(student._id);
  console.log('\nCleaned up test user & student.');

  console.log('\n--- ALL PROFILE TESTS COMPLETED ---');
  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
