const express = require('express');
const mongoose = require('mongoose');
const courseRoutes = require('../routes/courseRoutes');
const lessonRoutes = require('../routes/lesson.routes');
const Course = require('../models/Course');

const app = express();
app.use(express.json());
app.use('/api/courses', courseRoutes);
app.use(lessonRoutes);

const dummyCourse = new Course({
  courseId: 'CRS-000001',
  courseTitle: 'Homeopathy Fundamentals',
  shortDescription: 'Basic Principles',
  duration: '4 Weeks',
  instructor: 'Dr. Test',
  price: 500,
  modules: [
    {
      _id: new mongoose.Types.ObjectId('66c5d901a8b1c234567890bb'),
      moduleName: 'Module 1 — Introduction to Homeopathy',
      duration: '2 Hours',
      description: 'Overview of aphorisms',
      lessons: [
        {
          _id: new mongoose.Types.ObjectId('66c5d951a8b1c234567890cc'),
          lessonTitle: 'Understanding Miasms in Practice',
          lessonType: 'Live Class',
          fileOrLink: 'https://whitecoat.academy/live/session-101'
        }
      ]
    }
  ]
});

const originalFindOne = Course.findOne;
Course.findOne = async () => dummyCourse;

const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    // Test 1: GET /api/courses/CRS-000001/modules
    const resModules = await fetch(`http://localhost:${port}/api/courses/CRS-000001/modules`);
    const bodyModules = await resModules.json();
    console.log('GET Modules Status:', resModules.status);
    console.log('GET Modules Body:', JSON.stringify(bodyModules, null, 2));

    // Test 2: GET /api/courses/CRS-000001/modules/66c5d901a8b1c234567890bb/lessons
    const resLessons = await fetch(`http://localhost:${port}/api/courses/CRS-000001/modules/66c5d901a8b1c234567890bb/lessons`);
    const bodyLessons = await resLessons.json();
    console.log('GET Lessons Status:', resLessons.status);
    console.log('GET Lessons Body:', JSON.stringify(bodyLessons, null, 2));

    if (resModules.status === 200 && bodyModules.success && resLessons.status === 200 && bodyLessons.success) {
      console.log('✓ All GET Modules & Lessons endpoints working perfectly!');
    } else {
      console.error('❌ GET endpoints failed!');
    }
  } catch (err) {
    console.error('Fetch error:', err);
  } finally {
    Course.findOne = originalFindOne;
    server.close();
  }
});
