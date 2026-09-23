require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Course = require('../models/Course');
const User = require('../models/User');
const Student = require('../models/Student');
const LessonProgress = require('../models/LessonProgress');
const CourseProgress = require('../models/CourseProgress');
const studentCurriculumController = require('../controllers/studentCurriculumController');
const authController = require('../controllers/authController');
const studentProfileController = require('../controllers/studentProfileController');

function mockRes() {
  return {
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
}

async function runMultiModuleProgressTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING MULTI-MODULE COURSE PROGRESS API TESTS');
  console.log('====================================================\n');

  await connectDB();

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      testsPassed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      if (details) console.error(`     Details:`, details);
      testsFailed++;
    }
  }

  const timestamp = Date.now();

  try {
    // 1. Create a course with 2 modules: Module 1 (2 lessons), Module 2 (3 lessons) => Total = 5 lessons
    console.log('1️⃣ Creating Course with Module 1 (2 lessons) & Module 2 (3 lessons)...');
    const lesson1Id = new mongoose.Types.ObjectId();
    const lesson2Id = new mongoose.Types.ObjectId();
    const lesson3Id = new mongoose.Types.ObjectId();
    const lesson4Id = new mongoose.Types.ObjectId();
    const lesson5Id = new mongoose.Types.ObjectId();

    const course = await Course.create({
      courseTitle: `Multi-Module Test Course ${timestamp}`,
      instructor: 'Dr. Test Hahnemann',
      price: 199,
      status: 'Published',
      modules: [
        {
          moduleName: 'Module 1 - Fundamentals',
          lessons: [
            { _id: lesson1Id, lessonTitle: 'Lesson 1: Intro to Similia', lessonType: 'Recorded Video' },
            { _id: lesson2Id, lessonTitle: 'Lesson 2: Organon Aphorisms 1-10', lessonType: 'PDF Notes' }
          ]
        },
        {
          moduleName: 'Module 2 - Applied Practice',
          lessons: [
            { _id: lesson3Id, lessonTitle: 'Lesson 3: Case Taking', lessonType: 'Recorded Video' },
            { _id: lesson4Id, lessonTitle: 'Lesson 4: Repertorization', lessonType: 'Recorded Video' },
            { _id: lesson5Id, lessonTitle: 'Lesson 5: Potency Selection', lessonType: 'PDF Notes' }
          ]
        }
      ]
    });

    console.log(`   Course created with ID: ${course._id} (${course.courseId}), total modules: 2, total lessons: 5`);

    // 2. Create Student S1 enrolled in this course
    const s1User = await User.create({
      name: `MultiModule Student ${timestamp}`,
      email: `mm_student_${timestamp}@test.com`,
      password: 'hashedpassword',
      role: 'student',
      courseRef: course._id,
      courseId: course.courseId
    });
    const s1Student = await Student.create({
      userId: s1User._id,
      name: `MultiModule Student ${timestamp}`,
      email: `mm_student_${timestamp}@test.com`,
      courseRef: course._id,
      courseId: course.courseId,
      status: 'Active',
      accountStatus: 'Approved',
      subscriptionStatus: 'Active'
    });

    const s1ReqUser = {
      id: s1User._id.toString(),
      userId: s1User._id.toString(),
      studentId: s1Student._id.toString(),
      email: s1User.email,
      role: 'student',
      courseRef: course._id.toString(),
      courseId: course.courseId
    };

    // -------------------------------------------------------------
    // TEST 1: Initial State -> Total = 5, Completed = 0, Progress = 0%
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Check Initial Progress (0 Completed) ---');
    {
      const req = { user: s1ReqUser, params: { courseId: course._id.toString() } };
      const res = mockRes();
      await studentCurriculumController.getMyProgress(req, res);

      assert('GET /api/student/courses/:courseId/progress returned 200', res.statusCode === 200);
      assert('totalLessons is 5', res.body.totalLessons === 5, res.body.totalLessons);
      assert('totalItems is 5', res.body.totalItems === 5);
      assert('completedLessons is 0', res.body.completedLessons === 0, res.body.completedLessons);
      assert('completionPercentage is 0%', res.body.completionPercentage === 0, res.body.completionPercentage);
      assert('progressPercentage is 0%', res.body.progressPercentage === 0, res.body.progressPercentage);
      assert('status is Not Started', res.body.status === 'Not Started', res.body.status);
    }

    // -------------------------------------------------------------
    // TEST 2: Student completes 2 lessons out of 5 (e.g. Lesson 1 and Lesson 3)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Student Completes 2 Lessons (Lesson 1 from Mod 1, Lesson 3 from Mod 2) ---');
    {
      // Complete Lesson 1 (Module 1)
      const req1 = {
        user: s1ReqUser,
        params: {
          courseId: course._id.toString(),
          moduleId: course.modules[0]._id.toString(),
          lessonId: lesson1Id.toString()
        },
        body: { completed: true, videoWatched: true, watchedPercent: 100 }
      };
      const res1 = mockRes();
      await studentCurriculumController.updateLessonProgress(req1, res1);
      assert('Completed Lesson 1 in Module 1 returned 200', res1.statusCode === 200);

      // Complete Lesson 3 (Module 2)
      const req2 = {
        user: s1ReqUser,
        params: {
          courseId: course._id.toString(),
          moduleId: course.modules[1]._id.toString(),
          lessonId: lesson3Id.toString()
        },
        body: { completed: true, videoWatched: true, watchedPercent: 100 }
      };
      const res2 = mockRes();
      await studentCurriculumController.updateLessonProgress(req2, res2);
      assert('Completed Lesson 3 in Module 2 returned 200', res2.statusCode === 200);
    }

    // -------------------------------------------------------------
    // TEST 3: Verify GET /api/student/courses/:courseId/progress -> 2 / 5 = 40%
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Verify getMyProgress (2 Completed out of 5 across all modules) ---');
    {
      const req = { user: s1ReqUser, params: { courseId: course._id.toString() } };
      const res = mockRes();
      await studentCurriculumController.getMyProgress(req, res);

      assert('totalLessons = 5 (all modules included)', res.body.totalLessons === 5, res.body.totalLessons);
      assert('completedLessons = 2', res.body.completedLessons === 2, res.body.completedLessons);
      assert('completionPercentage = 40%', res.body.completionPercentage === 40, res.body.completionPercentage);
      assert('progressPercentage = 40%', res.body.progressPercentage === 40, res.body.progressPercentage);
      assert('progress ratio = 0.4', res.body.progress === 0.4, res.body.progress);
      assert('completedLessonIds contains [lesson1, lesson3]',
        res.body.completedLessonIds.includes(lesson1Id.toString()) &&
        res.body.completedLessonIds.includes(lesson3Id.toString()) &&
        res.body.completedLessonIds.length === 2
      );
      assert('status is In Progress', res.body.status === 'In Progress');
    }

    // -------------------------------------------------------------
    // TEST 4: Verify GET /api/student/courses (getMyCourses) -> 2 / 5 = 40%
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Verify getMyCourses ---');
    {
      const req = { user: s1ReqUser };
      const res = mockRes();
      await studentCurriculumController.getMyCourses(req, res);

      assert('getMyCourses returned 200', res.statusCode === 200);
      const targetCourse = (res.body.data || []).find(c => c._id.toString() === course._id.toString());
      assert('Course found in student course list', !!targetCourse);
      assert('Course totalLessons = 5', targetCourse.totalLessons === 5, targetCourse.totalLessons);
      assert('Course completedLessons = 2', targetCourse.completedLessons === 2, targetCourse.completedLessons);
      assert('Course completionPercentage = 40%', targetCourse.completionPercentage === 40, targetCourse.completionPercentage);
      assert('Course progressPercentage = 40%', targetCourse.progressPercentage === 40, targetCourse.progressPercentage);
      assert('Course totalModules = 2', targetCourse.totalModules === 2, targetCourse.totalModules);
    }

    // -------------------------------------------------------------
    // TEST 5: Verify GET /api/student/courses/:courseId/learn (getMyCourseContent)
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Verify getMyCourseContent ---');
    {
      const req = { user: s1ReqUser, params: { courseId: course._id.toString() } };
      const res = mockRes();
      await studentCurriculumController.getMyCourseContent(req, res);

      assert('getMyCourseContent returned 200', res.statusCode === 200);
      assert('Summary totalLessons = 5', res.body.summary.totalLessons === 5, res.body.summary.totalLessons);
      assert('Summary completedLessons = 2', res.body.summary.completedLessons === 2, res.body.summary.completedLessons);
      assert('Summary completionPercentage = 40%', res.body.summary.completionPercentage === 40, res.body.summary.completionPercentage);
      assert('Summary progressPercentage = 40%', res.body.summary.progressPercentage === 40, res.body.summary.progressPercentage);
    }

    // -------------------------------------------------------------
    // TEST 6: Persistence across Logout / Login (authController & profileController)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Verify Persistence Across Re-Login & Profile API ---');
    {
      // Simulate universal login / me endpoint
      const freshUser = await User.findById(s1User._id);
      const freshStudent = await Student.findOne({ userId: s1User._id });
      const userRes = await authController.buildUserResponse(freshUser, freshStudent);

      assert('Login response contains assigned course', userRes.courses && userRes.courses.length > 0);
      const loginCourse = userRes.courses[0];
      assert('Login course totalLessons = 5', loginCourse.totalLessons === 5, loginCourse.totalLessons);
      assert('Login course completedLessons = 2', loginCourse.completedLessons === 2, loginCourse.completedLessons);
      assert('Login course completionPercentage = 40%', loginCourse.completionPercentage === 40, loginCourse.completionPercentage);
      assert('Login course progressPercentage = 40%', loginCourse.progressPercentage === 40, loginCourse.progressPercentage);
      assert('Root-level userRes.totalLessons = 5', userRes.totalLessons === 5, userRes.totalLessons);
      assert('Root-level userRes.completedLessons = 2', userRes.completedLessons === 2, userRes.completedLessons);
      assert('Root-level userRes.progressPercentage = 40%', userRes.progressPercentage === 40, userRes.progressPercentage);

      // Verify Profile API
      const profileRes = await studentProfileController.buildProfileResponse(freshUser, freshStudent);
      assert('Profile response totalLessons = 5', profileRes.totalLessons === 5, profileRes.totalLessons);
      assert('Profile response completedLessons = 2', profileRes.completedLessons === 2, profileRes.completedLessons);
      assert('Profile response completionPercentage = 40%', profileRes.completionPercentage === 40, profileRes.completionPercentage);
      assert('Profile response progressPercentage = 40%', profileRes.progressPercentage === 40, profileRes.progressPercentage);
    }

    // -------------------------------------------------------------
    // Cleanup test data
    // -------------------------------------------------------------
    console.log('\n🧹 Cleaning up test artifacts...');
    await Course.findByIdAndDelete(course._id);
    await User.findByIdAndDelete(s1User._id);
    await Student.findByIdAndDelete(s1Student._id);
    await LessonProgress.deleteMany({ courseId: course._id });
    await CourseProgress.deleteMany({ courseId: course._id });
    console.log('Cleanup completed.');

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
    await mongoose.disconnect();
  }
}

runMultiModuleProgressTests();
