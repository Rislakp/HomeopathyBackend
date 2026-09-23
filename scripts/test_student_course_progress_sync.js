const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const LessonProgress = require('../models/LessonProgress');
const CourseProgress = require('../models/CourseProgress');
const {
  getMyCourses,
  getMyCourseContent,
  updateLessonProgress,
  saveCourseProgress,
  getMyProgress,
} = require('../controllers/studentCurriculumController');
const { universalLogin, studentLogin, getMe } = require('../controllers/authController');
const { getProfile } = require('../controllers/studentProfileController');

require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb+srv://developer:WhiteCode2026@cluster0.n1tyh.mongodb.net/homeopathy?retryWrites=true&w=majority';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runTests() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const suffix = Date.now();
  const testEmail = `test_progress_student_${suffix}@example.com`;
  const testPassword = 'Password123!';
  let testUser = null;
  let testStudent = null;
  let testCourse = null;

  try {
    // 1. Create a dummy test course with 2 modules and 4 total lessons
    const courseObjId = new mongoose.Types.ObjectId();
    const mod1Id = new mongoose.Types.ObjectId().toString();
    const mod2Id = new mongoose.Types.ObjectId().toString();
    const lesson1Id = new mongoose.Types.ObjectId().toString();
    const lesson2Id = new mongoose.Types.ObjectId().toString();
    const lesson3Id = new mongoose.Types.ObjectId().toString();
    const lesson4Id = new mongoose.Types.ObjectId().toString();

    testCourse = await Course.create({
      _id: courseObjId,
      courseId: `crs_${suffix}`,
      courseTitle: `Test Dynamic Progress Course ${suffix}`,
      instructor: 'Dr. Test Instructor',
      price: 999,
      status: 'Published',
      modules: [
        {
          _id: mod1Id,
          moduleName: 'Module 1: Foundations',
          lessons: [
            {
              _id: lesson1Id,
              lessonTitle: 'Lesson 1.1 Intro',
              lessonType: 'Recorded Video',
              videoUrl: 'https://example.com/video1.mp4',
            },
            {
              _id: lesson2Id,
              lessonTitle: 'Lesson 1.2 Materia Medica Basics',
              lessonType: 'PDF Notes',
              pdfNotes: [{ title: 'Notes 1.2', url: 'https://example.com/notes1.pdf' }],
            },
          ],
        },
        {
          _id: mod2Id,
          moduleName: 'Module 2: Advanced Case Taking',
          lessons: [
            {
              _id: lesson3Id,
              lessonTitle: 'Lesson 2.1 Case Analysis',
              lessonType: 'Recorded Video',
              videoUrl: 'https://example.com/video3.mp4',
            },
            {
              _id: lesson4Id,
              lessonTitle: 'Lesson 2.2 Repertory Practical',
              lessonType: 'PDF Notes',
              pdfNotes: [{ title: 'Repertory.pdf', url: 'https://example.com/rep.pdf' }],
            },
          ],
        },
      ],
    });

    console.log(`Created test course with 2 modules and 4 lessons (${testCourse._id})`);

    // 2. Create Student User & Student document
    testUser = await User.create({
      name: 'Dynamic Progress Student',
      email: testEmail,
      password: testPassword,
      role: 'student',
      phone: `999${String(suffix).slice(-7)}`,
      contactNumber: `999${String(suffix).slice(-7)}`,
      qualification: 'BHMS',
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
      dateOfBirth: '1998-01-01',
      qualification: 'BHMS',
      course: testCourse.courseTitle,
      courseId: testCourse.courseId,
      courseRef: testCourse._id,
      subscription: 'Active',
      subscriptionStatus: 'Active',
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    console.log(`Created test student ${testStudent._id} for user ${testUser._id}\n`);

    // Helper mock response
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

    // TEST 1: Login reflects initial 0% progress with accurate totalLessons = 4
    console.log('--- TEST 1: Student Login Dynamic Progress ---');
    {
      const req = {
        body: { email: testEmail, password: testPassword },
      };
      const res = createMockRes();
      await universalLogin(req, res);

      assert(res.statusCode === 200, 'Universal login returns 200');
      assert(res.data.user.courses.length > 0, 'User response contains assigned courses');
      const courseItem = res.data.user.courses[0];
      assert(courseItem.totalLessons === 4, `Total lessons equals 4 (got ${courseItem.totalLessons})`);
      assert(courseItem.completedLessons === 0, `Completed lessons equals 0 initially (got ${courseItem.completedLessons})`);
      assert(courseItem.completionPercentage === 0, 'Completion percentage is 0');
      assert(courseItem.status === 'Not Started', 'Status is Not Started');
    }

    // TEST 2: GET /api/student/courses returns dynamic progress
    console.log('\n--- TEST 2: GET /api/student/courses ---');
    {
      const req = {
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await getMyCourses(req, res);

      assert(res.statusCode === 200, 'getMyCourses returns 200');
      assert(res.data.data.length > 0, 'getMyCourses returns enrolled course list');
      const c = res.data.data[0];
      assert(c.totalLessons === 4, `Course has totalLessons = 4 (got ${c.totalLessons})`);
      assert(c.completedLessons === 0, 'Course has completedLessons = 0');
      assert(Array.isArray(c.completedLessonIds), 'completedLessonIds is an array');
    }

    // TEST 3: GET /api/student/courses/:courseId/learn returns full content with summary
    console.log('\n--- TEST 3: GET /api/student/courses/:courseId/learn ---');
    {
      const req = {
        params: { courseId: testCourse._id.toString() },
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await getMyCourseContent(req, res);

      assert(res.statusCode === 200, 'getMyCourseContent returns 200');
      assert(res.data.data.summary.totalLessons === 4, `Summary totalLessons = 4 (got ${res.data.data.summary.totalLessons})`);
      assert(res.data.data.summary.completedLessons === 0, 'Summary completedLessons = 0');
      assert(res.data.data.summary.status === 'Not Started', 'Summary status = Not Started');
    }

    // TEST 4: Update Lesson 1 progress to completed (watch video 95%)
    console.log('\n--- TEST 4: Update Lesson 1.1 Progress to Completed ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson1Id,
        },
        body: {
          videoProgress: 950,
          videoDuration: 1000,
          videoWatched: true,
          activeTimeSeconds: 120,
        },
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await updateLessonProgress(req, res);

      assert(res.statusCode === 200, 'updateLessonProgress returns 200');
      assert(res.data.summary.totalLessons === 4, 'Summary totalLessons = 4');
      assert(res.data.summary.completedLessons === 1, `Summary completedLessons = 1 (got ${res.data.summary.completedLessons})`);
      assert(res.data.summary.completionPercentage === 25, `Summary completionPercentage = 25% (got ${res.data.summary.completionPercentage}%)`);
      assert(res.data.summary.status === 'In Progress', 'Summary status = In Progress');
      assert(res.data.summary.completedLessonIds.includes(lesson1Id), 'completedLessonIds includes lesson1Id');
    }

    // TEST 5: Update Lesson 1.2 (PDF view)
    console.log('\n--- TEST 5: Update Lesson 1.2 Progress (PDF viewed) ---');
    {
      const req = {
        params: {
          courseId: testCourse._id.toString(),
          moduleId: mod1Id,
          lessonId: lesson2Id,
        },
        body: {
          pdfViewed: true,
          activeTimeSeconds: 180,
        },
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await updateLessonProgress(req, res);

      assert(res.statusCode === 200, 'updateLessonProgress returns 200');
      assert(res.data.summary.completedLessons === 2, `Summary completedLessons = 2 (got ${res.data.summary.completedLessons})`);
      assert(res.data.summary.completionPercentage === 50, `Summary completionPercentage = 50% (got ${res.data.summary.completionPercentage}%)`);
      assert(res.data.summary.completedLessonIds.includes(lesson2Id), 'completedLessonIds includes lesson2Id');
    }

    // TEST 6: GET /api/student/courses/:courseId/progress returns synchronized 50% state
    console.log('\n--- TEST 6: GET /api/student/courses/:courseId/progress Persistent Sync ---');
    {
      const req = {
        params: { courseId: testCourse._id.toString() },
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await getMyProgress(req, res);

      assert(res.statusCode === 200, 'getMyProgress returns 200');
      assert(res.data.completedLessons === 2, `completedLessons = 2 (got ${res.data.completedLessons})`);
      assert(res.data.totalLessons === 4, `totalLessons = 4 (got ${res.data.totalLessons})`);
      assert(res.data.completionPercentage === 50, `completionPercentage = 50% (got ${res.data.completionPercentage}%)`);
      assert(res.data.completedLessonIds.length === 2, 'completedLessonIds length is 2');
      assert(res.data.status === 'In Progress', 'status is In Progress');
    }

    // TEST 7: Complete remaining lessons (2.1 & 2.2) via batch saveCourseProgress -> 100% Completed
    console.log('\n--- TEST 7: Complete Course via Batch saveCourseProgress ---');
    {
      const req = {
        params: { courseId: testCourse._id.toString() },
        body: {
          completedLessonIds: [lesson3Id, lesson4Id],
        },
        user: {
          id: testStudent._id.toString(),
          studentId: testStudent._id.toString(),
          userId: testUser._id.toString(),
          email: testEmail,
          role: 'student',
          courseRef: testCourse._id.toString(),
          courseId: testCourse.courseId,
        },
      };
      const res = createMockRes();
      await saveCourseProgress(req, res);

      assert(res.statusCode === 200, 'saveCourseProgress returns 200');
      assert(res.data.summary.completedLessons === 4, `Summary completedLessons = 4 (got ${res.data.summary.completedLessons})`);
      assert(res.data.summary.completionPercentage === 100, `Summary completionPercentage = 100% (got ${res.data.summary.completionPercentage}%)`);
      assert(res.data.summary.status === 'Completed', `Summary status = Completed (got ${res.data.summary.status})`);
    }

    // TEST 8: Verify Student Login now returns 100% Completed immediately
    console.log('\n--- TEST 8: Re-login Reflects 100% Real-Time DB State Instantly ---');
    {
      const req = {
        body: { email: testEmail, password: testPassword },
      };
      const res = createMockRes();
      await studentLogin(req, res);

      assert(res.statusCode === 200, 'studentLogin returns 200');
      const courseItem = res.data.user.courses[0];
      assert(courseItem.totalLessons === 4, 'totalLessons is 4');
      assert(courseItem.completedLessons === 4, `completedLessons is 4 (got ${courseItem.completedLessons})`);
      assert(courseItem.completionPercentage === 100, `completionPercentage is 100% (got ${courseItem.completionPercentage}%)`);
      assert(courseItem.status === 'Completed', `status is Completed (got ${courseItem.status})`);
      assert(courseItem.completedLessonIds.length === 4, 'completedLessonIds contains all 4 lessons');
    }

    // TEST 9: Student Profile fetch /api/students/profile/:id reflects progress
    console.log('\n--- TEST 9: Student Profile Endpoint Returns Course Progress ---');
    {
      const req = {
        params: { id: testUser._id.toString() },
        user: {
          id: testUser._id.toString(),
          userId: testUser._id.toString(),
          role: 'student',
        },
      };
      const res = createMockRes();
      await getProfile(req, res);

      assert(res.statusCode === 200, 'getProfile returns 200');
      assert(res.data.profile.courses.length > 0, 'Profile contains courses');
      const pCourse = res.data.profile.courses[0];
      assert(pCourse.completionPercentage === 100, `Profile course completionPercentage = 100% (got ${pCourse.completionPercentage}%)`);
      assert(pCourse.status === 'Completed', `Profile course status = Completed (got ${pCourse.status})`);
    }

    console.log('\n🎉 ALL PROGRESS TRACKING AND COMPLETION TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    if (testUser) await User.deleteOne({ _id: testUser._id });
    if (testStudent) await Student.deleteOne({ _id: testStudent._id });
    if (testCourse) {
      await Course.deleteOne({ _id: testCourse._id });
      await LessonProgress.deleteMany({ courseId: testCourse._id });
      await CourseProgress.deleteMany({ courseId: testCourse._id });
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
