const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const ContentItemProgress = require('../models/ContentItemProgress');
const LessonProgress = require('../models/LessonProgress');
const CourseProgress = require('../models/CourseProgress');

const studentCurriculumController = require('../controllers/studentCurriculumController');
const {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  updateContentItemProgress,
  getMyProgress,
  saveCourseProgress,
  addStudyTime,
} = studentCurriculumController;
const { universalLogin, studentLogin, getMe } = require('../controllers/authController');
const { getProfile } = require('../controllers/studentProfileController');

function createMockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING CONTENT-ITEM PROGRESS & STUDY TIME TESTS');
  console.log('====================================================\n');

  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(MONGO_URI);
  console.log('🔌 Connected to MongoDB');

  const suffix = Date.now();
  const testEmail = `content_prog_${suffix}@test.com`;
  const testPassword = 'Password123!';

  let testCourse = null;
  let testUser = null;
  let testStudent = null;

  try {
    const mod1Id = new mongoose.Types.ObjectId().toString();
    const lesson1Id = new mongoose.Types.ObjectId().toString();
    const lesson2Id = new mongoose.Types.ObjectId().toString();
    const lesson3Id = new mongoose.Types.ObjectId().toString();

    const item1_1 = new mongoose.Types.ObjectId().toString(); // videoPart
    const item1_2 = new mongoose.Types.ObjectId().toString(); // pdfNote
    const item1_3 = new mongoose.Types.ObjectId().toString(); // assignment
    const item1_4 = new mongoose.Types.ObjectId().toString(); // attachment

    const item2_1 = new mongoose.Types.ObjectId().toString(); // videoPart
    const item2_2 = new mongoose.Types.ObjectId().toString(); // pdfNote

    const item3_1 = new mongoose.Types.ObjectId().toString(); // videoPart

    // Course structure:
    // Lesson 1 = 4 items (videoPart, pdfNote, assignment, attachment)
    // Lesson 2 = 2 items (videoPart, pdfNote)
    // Lesson 3 = 1 item (videoPart)
    // Total = 7 items
    testCourse = await Course.create({
      courseId: `CRS-PROG-${suffix}`,
      courseTitle: `Content Progress Course ${suffix}`,
      instructor: 'Dr. Content Progress Tester',
      price: 1999,
      status: 'Published',
      modules: [
        {
          _id: mod1Id,
          moduleName: 'Module 1: Complete Curriculum',
          lessons: [
            {
              _id: lesson1Id,
              lessonTitle: 'Lesson 1: 4 Items',
              lessonType: 'Recorded Video',
              videoParts: [{ _id: item1_1, title: 'Video 1.1', url: 'https://example.com/v1.mp4', duration: 1800 }],
              pdfNotes: [{ _id: item1_2, title: 'PDF Note 1.2', url: 'https://example.com/n1.pdf' }],
              assignments: [{ _id: item1_3, title: 'Assignment 1.3', url: 'https://example.com/a1.pdf' }],
              attachments: [{ _id: item1_4, title: 'Attachment 1.4', url: 'https://example.com/att1.pdf' }],
            },
            {
              _id: lesson2Id,
              lessonTitle: 'Lesson 2: 2 Items',
              lessonType: 'Recorded Video',
              videoParts: [{ _id: item2_1, title: 'Video 2.1', url: 'https://example.com/v2.mp4', duration: 1200 }],
              pdfNotes: [{ _id: item2_2, title: 'PDF Note 2.2', url: 'https://example.com/n2.pdf' }],
            },
            {
              _id: lesson3Id,
              lessonTitle: 'Lesson 3: 1 Item',
              lessonType: 'Recorded Video',
              videoParts: [{ _id: item3_1, title: 'Video 3.1', url: 'https://example.com/v3.mp4', duration: 900 }],
            },
          ],
        },
      ],
    });

    console.log(`✅ Created Course with 3 Lessons and 7 total content items (${testCourse._id})`);

    // Create User and Student
    testUser = await User.create({
      name: 'Content Progress Student',
      email: testEmail,
      password: testPassword,
      role: 'student',
      phone: `998${String(suffix).slice(-7)}`,
      contactNumber: `998${String(suffix).slice(-7)}`,
      qualification: 'MD (Hom)',
      course: testCourse.courseTitle,
      courseId: testCourse.courseId,
      courseRef: testCourse._id,
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    testStudent = await Student.create({
      userId: testUser._id,
      name: testUser.name,
      email: testUser.email,
      phone: testUser.phone,
      contactNumber: testUser.contactNumber,
      dateOfBirth: '1995-05-15',
      qualification: 'MD (Hom)',
      course: testCourse.courseTitle,
      courseId: testCourse.courseId,
      courseRef: testCourse._id,
      subscription: 'Active',
      subscriptionStatus: 'Active',
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    console.log(`✅ Created Student ${testStudent._id}\n`);

    const userAuth = {
      id: testStudent._id.toString(),
      studentId: testStudent._id.toString(),
      userId: testUser._id.toString(),
      email: testEmail,
      role: 'student',
      courseRef: testCourse._id.toString(),
      courseId: testCourse.courseId,
    };

    // ----------------------------------------------------
    // STEP 1: INITIAL STATE (0 / 7, 0% Done, Study Time: 0s)
    // ----------------------------------------------------
    console.log('--- Step 1: Initial Progress Check (0 / 7) ---');
    {
      const req = {
        params: { courseId: testCourse._id.toString() },
        user: userAuth,
      };
      const res = createMockRes();
      await getMyProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.totalItems, 7, `totalItems should be 7, got ${res.data.totalItems}`);
      assert.strictEqual(res.data.completedItems, 0, `completedItems should be 0, got ${res.data.completedItems}`);
      assert.strictEqual(res.data.progressPercentage, 0, `progressPercentage should be 0, got ${res.data.progressPercentage}`);
      assert.strictEqual(res.data.studyTimeSeconds, 0, `studyTimeSeconds should be 0, got ${res.data.studyTimeSeconds}`);
      assert.strictEqual(res.data.status, 'Not Started');
      console.log('✅ PASS: Initial progress is 0 / 7, 0%, 0s study time');
    }

    // ----------------------------------------------------
    // STEP 2: COMPLETE ONE PDF (item 1_2) -> 1 / 7
    // ----------------------------------------------------
    console.log('\n--- Step 2: Complete 1st PDF (item 1_2) ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson1Id,
          itemId: item1_2,
        },
        body: {
          itemType: 'pdfNote',
          completed: true,
        },
        user: userAuth,
      };
      const res = createMockRes();
      await updateContentItemProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.completedItems, 1, `completedItems should be 1, got ${res.data.completedItems}`);
      assert.strictEqual(res.data.totalItems, 7, `totalItems should be 7, got ${res.data.totalItems}`);
      assert.strictEqual(res.data.summary.completedItems, 1);
      assert.strictEqual(res.data.summary.totalItems, 7);
      console.log('✅ PASS: Completed 1st PDF -> 1 / 7');
    }

    // ----------------------------------------------------
    // STEP 3: COMPLETE ANOTHER PDF (item 2_2) -> 2 / 7
    // ----------------------------------------------------
    console.log('\n--- Step 3: Complete 2nd PDF (item 2_2) ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson2Id,
          itemId: item2_2,
        },
        body: {
          itemType: 'pdfNote',
          completed: true,
        },
        user: userAuth,
      };
      const res = createMockRes();
      await updateContentItemProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.completedItems, 2, `completedItems should be 2, got ${res.data.completedItems}`);
      assert.strictEqual(res.data.totalItems, 7, `totalItems should be 7, got ${res.data.totalItems}`);
      console.log('✅ PASS: Completed 2nd PDF -> 2 / 7');
    }

    // ----------------------------------------------------
    // STEP 4: COMPLETE ONE ATTACHMENT (item 1_4) -> 3 / 7
    // ----------------------------------------------------
    console.log('\n--- Step 4: Complete Attachment (item 1_4) ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson1Id,
          itemId: item1_4,
        },
        body: {
          itemType: 'attachment',
          completed: true,
        },
        user: userAuth,
      };
      const res = createMockRes();
      await updateContentItemProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.completedItems, 3, `completedItems should be 3, got ${res.data.completedItems}`);
      assert.strictEqual(res.data.totalItems, 7, `totalItems should be 7, got ${res.data.totalItems}`);
      console.log('✅ PASS: Completed Attachment -> 3 / 7');
    }

    // ----------------------------------------------------
    // STEP 5: COMPLETE ONE VIDEO (item 1_1) with 480 seconds (8 min) study time -> 4 / 7, 57.14%, 480s
    // ----------------------------------------------------
    console.log('\n--- Step 5: Complete Video (item 1_1) with 480s Watch Duration ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson1Id,
          itemId: item1_1,
        },
        body: {
          itemType: 'videoPart',
          completed: true,
          durationSeconds: 480, // 8 minutes watched
        },
        user: userAuth,
      };
      const res = createMockRes();
      await updateContentItemProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.completedItems, 4, `completedItems should be 4, got ${res.data.completedItems}`);
      assert.strictEqual(res.data.totalItems, 7, `totalItems should be 7, got ${res.data.totalItems}`);
      assert.strictEqual(res.data.progressPercentage, 57.14, `progressPercentage should be 57.14, got ${res.data.progressPercentage}`);
      assert.strictEqual(res.data.progress, 0.5714, `progress should be 0.5714, got ${res.data.progress}`);
      assert.strictEqual(res.data.studyTimeSeconds, 480, `studyTimeSeconds should be 480, got ${res.data.studyTimeSeconds}`);
      assert.strictEqual(res.data.status, 'In Progress');
      console.log('✅ PASS: Completed Video with 480s -> 4 / 7 (57.14%), studyTimeSeconds = 480');
    }

    // ----------------------------------------------------
    // STEP 6: TEST STUDY TIME INCREMENT VIA startTime / endTime
    // ----------------------------------------------------
    console.log('\n--- Step 6: Add Study Time via startTime/endTime (e.g. 1200s) ---');
    {
      const now = Date.now();
      const startTime = new Date(now - 1200 * 1000).toISOString();
      const endTime = new Date(now).toISOString();

      const req = {
        params: { courseId: testCourse._id.toString() },
        body: { startTime, endTime },
        user: userAuth,
      };
      const res = createMockRes();
      await addStudyTime(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.data.studyTimeSeconds, 480 + 1200, `Total study time should be 1680s, got ${res.data.data.studyTimeSeconds}`);
      console.log('✅ PASS: addStudyTime with startTime/endTime accumulated to 1680s');
    }

    // ----------------------------------------------------
    // STEP 7: GET /api/student/courses/:courseId/progress EXACT SPEC VERIFICATION
    // ----------------------------------------------------
    console.log('\n--- Step 7: Verify GET /api/student/courses/:courseId/progress Response ---');
    {
      const req = {
        params: { courseId: testCourse._id.toString() },
        user: userAuth,
      };
      const res = createMockRes();
      await getMyProgress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.totalItems, 7);
      assert.strictEqual(res.data.completedItems, 4);
      assert.strictEqual(res.data.completedItemIds.length, 4);
      assert.strictEqual(res.data.progressPercentage, 57.14);
      assert.strictEqual(res.data.progress, 0.5714);
      assert.strictEqual(res.data.status, 'In Progress');
      assert.strictEqual(res.data.studyTimeSeconds, 1680);
      console.log('✅ PASS: Progress API returned exact spec matching payload:');
      console.log({
        totalItems: res.data.totalItems,
        completedItems: res.data.completedItems,
        completedItemIds: res.data.completedItemIds,
        progressPercentage: res.data.progressPercentage,
        progress: res.data.progress,
        status: res.data.status,
        studyTimeSeconds: res.data.studyTimeSeconds,
      });
    }

    // ----------------------------------------------------
    // STEP 8: PERSISTENCE ACROSS RE-LOGIN & PROFILE FETCH
    // ----------------------------------------------------
    console.log('\n--- Step 8: Persistence across Logout -> Login -> Profile Fetch ---');
    {
      // 1. Universal Login
      const loginReq = { body: { email: testEmail, password: testPassword } };
      const loginRes = createMockRes();
      await universalLogin(loginReq, loginRes);

      assert.strictEqual(loginRes.statusCode, 200);
      const userCourse = loginRes.data.user.courses[0];
      assert.strictEqual(userCourse.totalLessons, 7);
      assert.strictEqual(userCourse.completedLessons, 4);
      assert.strictEqual(userCourse.completedItemIds.length, 4);
      assert.strictEqual(userCourse.progressPercentage, 57);
      assert.strictEqual(userCourse.studyTimeSeconds, 1680);
      console.log('✅ PASS: Login returned real-time 4/7 (57%), 1680s study time');

      // 2. Student Profile Fetch
      const profReq = {
        params: { id: testUser._id.toString() },
        user: userAuth,
      };
      const profRes = createMockRes();
      await getProfile(profReq, profRes);

      assert.strictEqual(profRes.statusCode, 200);
      const profCourse = profRes.data.profile.courses[0];
      assert.strictEqual(profCourse.totalLessons, 7);
      assert.strictEqual(profCourse.completedLessons, 4);
      assert.strictEqual(profCourse.completedItemIds.length, 4);
      assert.strictEqual(profCourse.studyTimeSeconds, 1680);
      console.log('✅ PASS: Student profile fetch returned 4/7, 1680s study time');
    }

    console.log('\n🎉 ALL CONTENT-ITEM PROGRESS & STUDY TIME TESTS PASSED PERFECTLY!');
  } finally {
    console.log('\n🧹 Cleaning up test data...');
    if (testUser) await User.deleteOne({ _id: testUser._id });
    if (testStudent) await Student.deleteOne({ _id: testStudent._id });
    if (testCourse) {
      await Course.deleteOne({ _id: testCourse._id });
      await ContentItemProgress.deleteMany({ courseId: testCourse._id });
      await LessonProgress.deleteMany({ courseId: testCourse._id });
      await CourseProgress.deleteMany({ courseId: testCourse._id });
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
