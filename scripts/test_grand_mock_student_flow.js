require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const Exam = require('../models/Exam');
const User = require('../models/User');
const Student = require('../models/Student');
const examRoutes = require('../routes/exam.routes');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

(async () => {
  let server;
  try {
    console.log('Connecting to database...');
    await connectDB();

    const app = express();
    app.use(express.json());
    app.use(examRoutes);

    const port = 52599;
    server = await new Promise((resolve) => {
      const s = app.listen(port, () => {
        console.log(`Test server running on port ${port}`);
        resolve(s);
      });
    });

    // 1. Create or find a test student user & student profile with active status
    const Course = mongoose.models.Course || require('../models/Course');
    let anyCourse = await Course.findOne();

    let studentUser = await User.findOne({ email: 'student_test_grand_mock@test.com' });
    if (!studentUser) {
      studentUser = await User.create({
        name: 'Grand Mock Student Tester',
        email: 'student_test_grand_mock@test.com',
        role: 'student',
        password: 'password123',
        status: 'Active'
      });
    }

    let studentProfile = await Student.findOne({ userId: studentUser._id });
    if (!studentProfile) {
      studentProfile = await Student.create({
        userId: studentUser._id,
        name: 'Grand Mock Student Tester',
        email: 'student_test_grand_mock@test.com',
        accountStatus: 'Approved',
        status: 'Active',
        courseRef: anyCourse ? anyCourse._id : new mongoose.Types.ObjectId()
      });
    } else {
      studentProfile.accountStatus = 'Approved';
      studentProfile.status = 'Active';
      await studentProfile.save();
    }

    // Generate Student JWT Token
    const studentToken = jwt.sign(
      {
        id: studentUser._id.toString(),
        userId: studentUser._id.toString(),
        studentId: studentProfile._id.toString(),
        email: studentUser.email,
        role: 'student'
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Ensure we have at least one grand mock exam in the database
    let grandMockExam = await Exam.findOne({ testType: 'grand_mock' });
    if (!grandMockExam) {
      grandMockExam = await Exam.create({
        title: 'Diagnostic Grand Mock Test',
        testType: 'grand_mock',
        courseId: null,
        moduleId: null,
        marksPerQuestion: 1,
        negativeMark: 0.25,
        negativeMarkPenalty: 0.25,
        durationMinutes: 45,
        totalQuestions: 1,
        questions: [{
          questionText: 'What is the primary law of Homeopathy?',
          options: {
            A: 'Similia Similibus Curentur',
            B: 'Opposites Cure Opposites',
            C: 'Law of Maximum Dose',
            D: 'None'
          },
          correctOption: 'A'
        }]
      });
    }

    console.log('\n--- TEST 1: GET /api/exams/grand-mock as Authenticated Student without Course ---');
    const res1 = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/exams/grand-mock',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${studentToken}`
      }
    });

    console.log('Status:', res1.statusCode);
    console.log('Success:', res1.body?.success);
    console.log('Data is Array:', Array.isArray(res1.body?.data));
    console.log('Count:', res1.body?.data?.length);

    if (res1.statusCode !== 200 || !res1.body?.success || !Array.isArray(res1.body?.data)) {
      throw new Error(`Failed Test 1: ${JSON.stringify(res1.body)}`);
    }

    if (res1.body.data.length === 0) {
      throw new Error('Failed Test 1: Returned empty array [] for grand mocks!');
    }

    const firstExam = res1.body.data[0];
    console.log('First exam sample:', {
      id: firstExam._id,
      title: firstExam.title,
      testType: firstExam.testType,
      courseName: firstExam.courseName,
      negativeMark: firstExam.negativeMark,
      hasQuestionsInSummary: Boolean(firstExam.questions)
    });

    if (firstExam.testType !== 'grand_mock') {
      throw new Error(`Expected testType to be 'grand_mock', got '${firstExam.testType}'`);
    }

    if (firstExam.questions) {
      throw new Error('Summary list should exclude full questions array');
    }
    console.log('✅ PASS: GET /api/exams/grand-mock correctly returned published grand mock tests!');

    console.log('\n--- TEST 2: GET /api/v1/exams/grand-mock Alias Endpoint ---');
    const res2 = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/exams/grand-mock',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${studentToken}`
      }
    });

    if (res2.statusCode !== 200 || !res2.body?.success || res2.body.data.length === 0) {
      throw new Error(`Failed Test 2: ${JSON.stringify(res2.body)}`);
    }
    console.log('✅ PASS: GET /api/v1/exams/grand-mock alias works identically!');

    console.log('\n--- TEST 3: GET /api/exams/grand-mock/:id as Authenticated Student ---');
    const examId = grandMockExam._id.toString();
    const res3 = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/exams/grand-mock/${examId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${studentToken}`
      }
    });

    console.log('Status:', res3.statusCode);
    console.log('Success:', res3.body?.success);
    console.log('Exam title:', res3.body?.data?.title);
    console.log('Questions length:', res3.body?.data?.questions?.length);

    if (res3.statusCode !== 200 || !res3.body?.success || !res3.body?.data?.questions) {
      throw new Error(`Failed Test 3: ${JSON.stringify(res3.body)}`);
    }
    console.log('✅ PASS: Single grand mock exam fetched successfully by student without course restrictions!');

    console.log('\n========================================');
    console.log('ALL GRAND MOCK STUDENT PORTAL TESTS PASSED! 🎉');
    console.log('========================================\n');

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    await mongoose.disconnect();
  }
})();
