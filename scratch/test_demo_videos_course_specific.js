require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Course = require('../models/Course');
const DemoVideo = require('../models/DemoVideo');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

async function runTests() {
  console.log('--- STARTING DEMO VIDEOS COURSE-SPECIFIC UNIT & INTEGRATION TESTS ---');

  // Set up Express app with all routes
  const app = express();
  app.use(express.json());
  app.use('/api/courses', require('../routes/courseRoutes'));
  app.use('/api/v1/courses', require('../routes/courseRoutes'));
  app.use('/api/v1/demo-videos', require('../routes/demoVideoRoutes'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/homeopathy';

  let isConnected = false;
  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log('Connected to MongoDB for testing.');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }

  if (isConnected) {
    try {
      // Create test admin user in DB
      const adminEmail = `test_admin_${Date.now()}@test.com`;
      const adminUser = await User.create({
        name: 'Test Admin',
        email: adminEmail,
        password: 'password123',
        role: 'admin',
      });

      const adminToken = jwt.sign(
        { id: adminUser._id.toString(), userId: adminUser._id.toString(), role: 'admin', email: adminEmail },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      const adminHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      };

      // 1. Setup Test Courses
      const testCourse1Id = `CRS-TEST-${Date.now()}-1`;
      const testCourse2Id = `CRS-TEST-${Date.now()}-2`;

      const course1 = await Course.create({
        courseId: testCourse1Id,
        courseTitle: 'Materia Medica Test Course 1',
        instructor: 'Dr. Test 1',
        price: 999,
      });

      const course2 = await Course.create({
        courseId: testCourse2Id,
        courseTitle: 'Organon Test Course 2',
        instructor: 'Dr. Test 2',
        price: 1999,
      });

      console.log(`Created test courses: ${testCourse1Id} (${course1._id}) and ${testCourse2Id} (${course2._id})`);

      // 2. Test POST /api/v1/demo-videos without courseId (MUST FAIL 400)
      console.log('\n[TEST 1] POST /api/v1/demo-videos without courseId...');
      const resNoCourse = await fetch(`${baseUrl}/api/v1/demo-videos`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Demo without course',
          videoUrl: 'https://example.com/demo1.mp4',
        }),
      });
      const dataNoCourse = await resNoCourse.json();
      console.log('Status:', resNoCourse.status, 'Response:', dataNoCourse);
      if (resNoCourse.status === 400 && dataNoCourse.message === 'courseId is required') {
        console.log('✅ TEST 1 PASSED: courseId is strictly required.');
      } else {
        console.error('❌ TEST 1 FAILED');
      }

      // 3. Test POST /api/v1/demo-videos with non-existent courseId (MUST FAIL 404)
      console.log('\n[TEST 2] POST /api/v1/demo-videos with invalid courseId...');
      const resInvalidCourse = await fetch(`${baseUrl}/api/v1/demo-videos`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Demo with invalid course',
          videoUrl: 'https://example.com/demo_invalid.mp4',
          courseId: 'CRS-NONEXISTENT-999',
        }),
      });
      const dataInvalidCourse = await resInvalidCourse.json();
      console.log('Status:', resInvalidCourse.status, 'Response:', dataInvalidCourse);
      if (resInvalidCourse.status === 404) {
        console.log('✅ TEST 2 PASSED: Non-existent course rejected with 404.');
      } else {
        console.error('❌ TEST 2 FAILED');
      }

      // 4. Test POST multiple demo videos for Course 1
      console.log('\n[TEST 3] POST multiple demo videos for Course 1 (' + testCourse1Id + ')...');
      const resDemo1 = await fetch(`${baseUrl}/api/v1/demo-videos`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Course 1 - Demo Video A',
          description: 'Introduction to Course 1',
          videoUrl: 'https://res.cloudinary.com/test/demo1a.mp4',
          thumbnailUrl: 'https://res.cloudinary.com/test/thumb1a.jpg',
          duration: '10:00',
          courseId: testCourse1Id,
        }),
      });
      const dataDemo1 = await resDemo1.json();
      console.log('Created Demo 1A:', resDemo1.status, dataDemo1.data?._id);

      const resDemo2 = await fetch(`${baseUrl}/api/v1/demo-videos`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Course 1 - Demo Video B',
          description: 'Deep dive demo',
          videoUrl: 'https://res.cloudinary.com/test/demo1b.mp4',
          thumbnailUrl: 'https://res.cloudinary.com/test/thumb1b.jpg',
          duration: '15:00',
          courseId: testCourse1Id,
        }),
      });
      const dataDemo2 = await resDemo2.json();
      console.log('Created Demo 1B:', resDemo2.status, dataDemo2.data?._id);

      // 5. Test POST demo video for Course 2
      console.log('\n[TEST 4] POST demo video for Course 2 (' + testCourse2Id + ')...');
      const resDemo3 = await fetch(`${baseUrl}/api/v1/demo-videos`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Course 2 - Demo Video C',
          description: 'Organon demo',
          videoUrl: 'https://res.cloudinary.com/test/demo2c.mp4',
          thumbnailUrl: 'https://res.cloudinary.com/test/thumb2c.jpg',
          duration: '12:00',
          courseId: testCourse2Id,
        }),
      });
      const dataDemo3 = await resDemo3.json();
      console.log('Created Demo 2C:', resDemo3.status, dataDemo3.data?._id);

      // 6. Test GET /api/v1/demo-videos?courseId=CRS-TEST-... (Cross-course isolation)
      console.log('\n[TEST 5] GET /api/v1/demo-videos?courseId=' + testCourse1Id);
      const resGet1 = await fetch(`${baseUrl}/api/v1/demo-videos?courseId=${testCourse1Id}`);
      const dataGet1 = await resGet1.json();
      console.log('Status:', resGet1.status, 'Count:', dataGet1.count);
      const list1 = dataGet1.data || [];
      const hasOnlyCourse1 = list1.length === 2 && list1.every((d) => d.courseId === testCourse1Id);
      if (hasOnlyCourse1) {
        console.log('✅ TEST 5 PASSED: Filtered strictly to Course 1 demos (Count: 2).');
      } else {
        console.error('❌ TEST 5 FAILED. Data received:', list1);
      }

      console.log('\n[TEST 6] GET /api/v1/demo-videos?courseId=' + testCourse2Id);
      const resGet2 = await fetch(`${baseUrl}/api/v1/demo-videos?courseId=${testCourse2Id}`);
      const dataGet2 = await resGet2.json();
      console.log('Status:', resGet2.status, 'Count:', dataGet2.count);
      const list2 = dataGet2.data || [];
      const hasOnlyCourse2 = list2.length === 1 && list2[0].courseId === testCourse2Id;
      if (hasOnlyCourse2) {
        console.log('✅ TEST 6 PASSED: Filtered strictly to Course 2 demos (Count: 1).');
      } else {
        console.error('❌ TEST 6 FAILED. Data received:', list2);
      }

      // 7. Test Dedicated Route: GET /api/v1/courses/:courseId/demo-videos
      console.log('\n[TEST 7] GET /api/v1/courses/' + testCourse1Id + '/demo-videos');
      const resDedicated = await fetch(`${baseUrl}/api/v1/courses/${testCourse1Id}/demo-videos`);
      const dataDedicated = await resDedicated.json();
      console.log('Status:', resDedicated.status, 'Body courseId:', dataDedicated.courseId, 'Count:', dataDedicated.count);
      if (resDedicated.status === 200 && dataDedicated.courseId === testCourse1Id && dataDedicated.count === 2) {
        console.log('✅ TEST 7 PASSED: Dedicated course demo videos route returns exact payload.');
      } else {
        console.error('❌ TEST 7 FAILED');
      }

      // 8. Test Edit Demo Video: Preserve courseId when omitted
      console.log('\n[TEST 8] PUT /api/v1/demo-videos/:id (updating title without changing courseId)...');
      const demoToEdit = dataDemo1.data;
      const resEdit = await fetch(`${baseUrl}/api/v1/demo-videos/${demoToEdit._id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Course 1 - Demo Video A (Updated Title)',
        }),
      });
      const dataEdit = await resEdit.json();
      console.log('Status:', resEdit.status, 'Updated title:', dataEdit.data?.title, 'courseId preserved:', dataEdit.data?.courseId);
      if (resEdit.status === 200 && dataEdit.data?.courseId === testCourse1Id && dataEdit.data?.title.includes('Updated Title')) {
        console.log('✅ TEST 8 PASSED: courseId preserved during edit.');
      } else {
        console.error('❌ TEST 8 FAILED');
      }

      // 9. Test Delete Demo Video
      console.log('\n[TEST 9] DELETE /api/v1/demo-videos/:id...');
      const resDelete = await fetch(`${baseUrl}/api/v1/demo-videos/${demoToEdit._id}`, {
        method: 'DELETE',
        headers: adminHeaders,
      });
      const dataDelete = await resDelete.json();
      console.log('Status:', resDelete.status, 'Message:', dataDelete.message);
      if (resDelete.status === 200) {
        console.log('✅ TEST 9 PASSED: Demo video deleted successfully.');
      } else {
        console.error('❌ TEST 9 FAILED');
      }

      // Cleanup test data
      await DemoVideo.deleteMany({ courseId: { $in: [testCourse1Id, testCourse2Id] } });
      await Course.deleteMany({ courseId: { $in: [testCourse1Id, testCourse2Id] } });
      await User.findByIdAndDelete(adminUser._id);
      console.log('\nCleaned up test data.');
    } finally {
      await mongoose.disconnect();
    }
  }

  server.close();
  console.log('\n--- ALL DEMO VIDEO TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(console.error);
