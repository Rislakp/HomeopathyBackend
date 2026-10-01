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
  addStudyTime,
} = require('../controllers/studentCurriculumController');
const { studentLogin, universalLogin } = require('../controllers/authController');

require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb+srv://developer:WhiteCode2026@cluster0.n1tyh.mongodb.net/homeopathy?retryWrites=true&w=majority';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

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

async function runCourseIsolationAndPersistenceTests() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const suffix = Date.now();
  let courseA = null;
  let courseB = null;
  let student1User = null;
  let student1 = null;
  let student2User = null;
  let student2 = null;

  try {
    // -------------------------------------------------------------
    // 1. CREATE COURSE A: 3 modules, 6 lessons total
    //    Module 1 = 2 lessons, Module 2 = 3 lessons, Module 3 = 1 lesson
    // -------------------------------------------------------------
    const cA_mod1_l1 = new mongoose.Types.ObjectId().toString();
    const cA_mod1_l2 = new mongoose.Types.ObjectId().toString();
    const cA_mod2_l3 = new mongoose.Types.ObjectId().toString();
    const cA_mod2_l4 = new mongoose.Types.ObjectId().toString();
    const cA_mod2_l5 = new mongoose.Types.ObjectId().toString();
    const cA_mod3_l6 = new mongoose.Types.ObjectId().toString();

    courseA = await Course.create({
      courseId: `crs_A_${suffix}`,
      courseTitle: `Course A - Homeopathy Repertory ${suffix}`,
      instructor: 'Dr. Hahnemann',
      price: 1500,
      status: 'Published',
      modules: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 1: Principles',
          lessons: [
            { _id: cA_mod1_l1, lessonTitle: 'Lesson 1.1 Intro to Repertory', lessonType: 'Recorded Video' },
            { _id: cA_mod1_l2, lessonTitle: 'Lesson 1.2 Case Evaluation', lessonType: 'PDF Notes' },
          ],
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 2: Kent Repertory',
          lessons: [
            { _id: cA_mod2_l3, lessonTitle: 'Lesson 2.1 Mind Section', lessonType: 'Recorded Video' },
            { _id: cA_mod2_l4, lessonTitle: 'Lesson 2.2 Physical Generals', lessonType: 'Recorded Video' },
            { _id: cA_mod2_l5, lessonTitle: 'Lesson 2.3 Modalities', lessonType: 'PDF Notes' },
          ],
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 3: Synthesis & Clinical Cases',
          lessons: [
            { _id: cA_mod3_l6, lessonTitle: 'Lesson 3.1 Chronic Case Demonstration', lessonType: 'Recorded Video' },
          ],
        },
      ],
    });

    console.log(`Created Course A (${courseA._id}): 3 modules, 6 lessons total`);

    // -------------------------------------------------------------
    // 2. CREATE COURSE B: 3 modules, 10 lessons total
    //    Module 1 = 4 lessons, Module 2 = 3 lessons, Module 3 = 3 lessons
    // -------------------------------------------------------------
    const cB_lessons = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId().toString());

    courseB = await Course.create({
      courseId: `crs_B_${suffix}`,
      courseTitle: `Course B - Materia Medica Advanced ${suffix}`,
      instructor: 'Dr. Kent',
      price: 2500,
      status: 'Published',
      modules: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 1: Polycrests Part 1',
          lessons: [
            { _id: cB_lessons[0], lessonTitle: 'Lesson 1: Sulphur', lessonType: 'Recorded Video' },
            { _id: cB_lessons[1], lessonTitle: 'Lesson 2: Calcarea Carb', lessonType: 'Recorded Video' },
            { _id: cB_lessons[2], lessonTitle: 'Lesson 3: Lycopodium', lessonType: 'PDF Notes' },
            { _id: cB_lessons[3], lessonTitle: 'Lesson 4: Silica', lessonType: 'PDF Notes' },
          ],
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 2: Polycrests Part 2',
          lessons: [
            { _id: cB_lessons[4], lessonTitle: 'Lesson 5: Phosphorus', lessonType: 'Recorded Video' },
            { _id: cB_lessons[5], lessonTitle: 'Lesson 6: Natrum Mur', lessonType: 'Recorded Video' },
            { _id: cB_lessons[6], lessonTitle: 'Lesson 7: Sepia', lessonType: 'PDF Notes' },
          ],
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          moduleName: 'Module 3: Rare Remedies',
          lessons: [
            { _id: cB_lessons[7], lessonTitle: 'Lesson 8: Medorrhinum', lessonType: 'Recorded Video' },
            { _id: cB_lessons[8], lessonTitle: 'Lesson 9: Syphilinum', lessonType: 'Recorded Video' },
            { _id: cB_lessons[9], lessonTitle: 'Lesson 10: Psorinum', lessonType: 'PDF Notes' },
          ],
        },
      ],
    });

    console.log(`Created Course B (${courseB._id}): 3 modules, 10 lessons total\n`);

    // -------------------------------------------------------------
    // 3. CREATE STUDENT 1 (Enrolled in Course A & B)
    // -------------------------------------------------------------
    const student1Email = `student1_${suffix}@test.com`;
    const student1Password = 'Pass1234!';

    student1User = await User.create({
      name: 'Student One',
      email: student1Email,
      password: student1Password,
      role: 'student',
      contactNumber: `91111${String(suffix).slice(-5)}`,
      phone: `91111${String(suffix).slice(-5)}`,
      qualification: 'BHMS',
      course: courseA.courseTitle,
      courseId: courseA.courseId,
      courseRef: courseA._id,
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    student1 = await Student.create({
      userId: student1User._id,
      name: student1User.name,
      email: student1User.email,
      phone: student1User.phone,
      contactNumber: student1User.contactNumber,
      dateOfBirth: '2000-01-01',
      qualification: 'BHMS',
      course: courseA.courseTitle,
      courseId: courseA.courseId,
      courseRef: courseA._id,
      subscription: 'Active',
      subscriptionStatus: 'Active',
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    // -------------------------------------------------------------
    // 4. CREATE STUDENT 2 (For Authorization Isolation Checks)
    // -------------------------------------------------------------
    const student2Email = `student2_${suffix}@test.com`;
    const student2Password = 'Pass1234!';

    student2User = await User.create({
      name: 'Student Two',
      email: student2Email,
      password: student2Password,
      role: 'student',
      contactNumber: `92222${String(suffix).slice(-5)}`,
      phone: `92222${String(suffix).slice(-5)}`,
      qualification: 'BHMS',
      course: courseA.courseTitle,
      courseId: courseA.courseId,
      courseRef: courseA._id,
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    student2 = await Student.create({
      userId: student2User._id,
      name: student2User.name,
      email: student2User.email,
      phone: student2User.phone,
      contactNumber: student2User.contactNumber,
      dateOfBirth: '2001-01-01',
      qualification: 'BHMS',
      course: courseA.courseTitle,
      courseId: courseA.courseId,
      courseRef: courseA._id,
      subscription: 'Active',
      subscriptionStatus: 'Active',
      status: 'Active',
      accountStatus: 'Approved',
      isApproved: true,
    });

    console.log(`Created Student 1 (${student1._id}) and Student 2 (${student2._id})\n`);

    const s1Auth = {
      id: student1._id.toString(),
      studentId: student1._id.toString(),
      userId: student1User._id.toString(),
      email: student1Email,
      role: 'student',
      courseRef: courseA._id.toString(),
      courseId: courseA.courseId,
    };

    const s2Auth = {
      id: student2._id.toString(),
      studentId: student2._id.toString(),
      userId: student2User._id.toString(),
      email: student2Email,
      role: 'student',
      courseRef: courseA._id.toString(),
      courseId: courseA.courseId,
    };

    // =============================================================
    // TEST SECTION A: COURSE A PROGRESS (6 lessons, complete 2)
    // =============================================================
    console.log('=== TEST SECTION A: Course A Progress Setup ===');
    // Complete 2 lessons in Course A for Student 1
    const saveResA = createMockRes();
    await saveCourseProgress(
      {
        params: { courseId: courseA._id.toString() },
        body: { completedLessonIds: [cA_mod1_l1, cA_mod2_l3] },
        user: s1Auth,
      },
      saveResA
    );
    assert(saveResA.statusCode === 200, 'Course A batch progress saved successfully');
    assert(saveResA.data.summary.totalLessons === 6, `Course A totalLessons = 6 (got ${saveResA.data.summary.totalLessons})`);
    assert(saveResA.data.summary.completedLessons === 2, `Course A completedLessons = 2 (got ${saveResA.data.summary.completedLessons})`);
    assert(saveResA.data.summary.completedLessonIds.length === 2, 'Course A completedLessonIds length is 2');
    assert(
      saveResA.data.summary.completedLessonIds.includes(cA_mod1_l1) &&
      saveResA.data.summary.completedLessonIds.includes(cA_mod2_l3),
      'Course A completedLessonIds contains [cA_mod1_l1, cA_mod2_l3]'
    );

    // Record study time for Course A (e.g. 1800 seconds = 0.5 hours)
    const studyResA = createMockRes();
    await addStudyTime(
      {
        params: { courseId: courseA._id.toString() },
        body: { incrementSeconds: 1800 },
        user: s1Auth,
      },
      studyResA
    );
    assert(studyResA.statusCode === 200, 'Study time of 1800s recorded for Course A');
    assert(studyResA.data.data.studyTimeSeconds === 1800, 'Study time is 1800 seconds');

    // =============================================================
    // TEST SECTION B: COURSE B PROGRESS (10 lessons, complete 7)
    // =============================================================
    console.log('\n=== TEST SECTION B: Course B Progress Setup ===');
    // Complete 7 lessons in Course B for Student 1: lessons [0, 1, 2, 4, 5, 7, 8]
    const completedBIds = [
      cB_lessons[0],
      cB_lessons[1],
      cB_lessons[2],
      cB_lessons[4],
      cB_lessons[5],
      cB_lessons[7],
      cB_lessons[8],
    ];
    const saveResB = createMockRes();
    await saveCourseProgress(
      {
        params: { courseId: courseB._id.toString() },
        body: { completedLessonIds: completedBIds },
        user: s1Auth,
      },
      saveResB
    );
    assert(saveResB.statusCode === 200, 'Course B batch progress saved successfully');
    assert(saveResB.data.summary.totalLessons === 10, `Course B totalLessons = 10 (got ${saveResB.data.summary.totalLessons})`);
    assert(saveResB.data.summary.completedLessons === 7, `Course B completedLessons = 7 (got ${saveResB.data.summary.completedLessons})`);
    assert(saveResB.data.summary.completedLessonIds.length === 7, 'Course B completedLessonIds length is 7');
    assert(saveResB.data.summary.completionPercentage === 70, `Course B completionPercentage = 70% (got ${saveResB.data.summary.completionPercentage}%)`);

    // Record study time for Course B (e.g. 3600 seconds = 1.0 hour)
    const studyResB = createMockRes();
    await addStudyTime(
      {
        params: { courseId: courseB._id.toString() },
        body: { incrementSeconds: 3600 },
        user: s1Auth,
      },
      studyResB
    );
    assert(studyResB.statusCode === 200, 'Study time of 3600s recorded for Course B');

    // =============================================================
    // TEST SECTION C: COURSE ISOLATION VERIFICATION
    // =============================================================
    console.log('\n=== TEST SECTION C: Course Isolation Verification ===');

    // Query Course A progress endpoint
    const progResA = createMockRes();
    await getMyProgress({ params: { courseId: courseA._id.toString() }, user: s1Auth }, progResA);
    assert(progResA.statusCode === 200, 'GET Course A progress returns 200');
    assert(progResA.data.courseId === courseA.courseId, `Course A courseId matches ${courseA.courseId}`);
    assert(progResA.data.totalLessons === 6, `Course A totalLessons is still 6 (got ${progResA.data.totalLessons})`);
    assert(progResA.data.completedLessons === 2, `Course A completedLessons is still 2 (got ${progResA.data.completedLessons})`);
    assert(progResA.data.completedLessonIds.length === 2, 'Course A has exactly 2 completed lesson IDs');
    assert(progResA.data.studyTimeSeconds === 1800, `Course A cumulative study time is 1800s (got ${progResA.data.studyTimeSeconds}s)`);

    // Query Course B progress endpoint
    const progResB = createMockRes();
    await getMyProgress({ params: { courseId: courseB._id.toString() }, user: s1Auth }, progResB);
    assert(progResB.statusCode === 200, 'GET Course B progress returns 200');
    assert(progResB.data.courseId === courseB.courseId, `Course B courseId matches ${courseB.courseId}`);
    assert(progResB.data.totalLessons === 10, `Course B totalLessons is still 10 (got ${progResB.data.totalLessons})`);
    assert(progResB.data.completedLessons === 7, `Course B completedLessons is still 7 (got ${progResB.data.completedLessons})`);
    assert(progResB.data.completedLessonIds.length === 7, 'Course B has exactly 7 completed lesson IDs');
    assert(progResB.data.studyTimeSeconds === 3600, `Course B cumulative study time is 3600s (got ${progResB.data.studyTimeSeconds}s)`);

    // Verify no cross-pollution between Course A and Course B IDs
    const crossPollution = progResA.data.completedLessonIds.some((id) => completedBIds.includes(id));
    assert(!crossPollution, 'Course A completedLessonIds contains NO lesson IDs from Course B (Course Isolation Confirmed)');

    // =============================================================
    // TEST SECTION D: STUDENT / AUTHORIZATION ISOLATION
    // =============================================================
    console.log('\n=== TEST SECTION D: Student & Authorization Isolation ===');
    // Student 2 queries Course A: should have 0 completed lessons (independent of Student 1)
    const s2ProgResA = createMockRes();
    await getMyProgress({ params: { courseId: courseA._id.toString() }, user: s2Auth }, s2ProgResA);
    assert(s2ProgResA.statusCode === 200, 'Student 2 querying Course A returns 200');
    assert(s2ProgResA.data.totalLessons === 6, 'Student 2 sees totalLessons = 6 for Course A');
    assert(s2ProgResA.data.completedLessons === 0, `Student 2 has completedLessons = 0 (isolated from Student 1's progress)`);
    assert(s2ProgResA.data.completedLessonIds.length === 0, 'Student 2 completedLessonIds is empty');

    // =============================================================
    // TEST SECTION E: PERSISTENCE ACROSS RE-LOGIN / SESSIONS
    // =============================================================
    console.log('\n=== TEST SECTION E: Persistence Across Re-Login ===');
    // Simulate re-login for Student 1
    const loginRes = createMockRes();
    await studentLogin({ body: { email: student1Email, password: student1Password } }, loginRes);
    assert(loginRes.statusCode === 200, 'Student 1 re-login succeeds with 200');
    assert(loginRes.data.user.courses.length > 0, 'User object has courses array populated');
    const userCourseA = loginRes.data.user.courses[0];
    assert(userCourseA.totalLessons === 6, `Re-login payload has totalLessons = 6 (got ${userCourseA.totalLessons})`);
    assert(userCourseA.completedLessons === 2, `Re-login payload has completedLessons = 2 (got ${userCourseA.completedLessons})`);
    assert(userCourseA.completedLessonIds.length === 2, 'Re-login payload has 2 completedLessonIds');
    assert(userCourseA.completionPercentage === 33, `Re-login payload has completionPercentage = 33% (got ${userCourseA.completionPercentage}%)`);

    // Fetch Course A Learn Content (/api/student/courses/:courseId/learn)
    const learnResA = createMockRes();
    await getMyCourseContent({ params: { courseId: courseA._id.toString() }, user: s1Auth }, learnResA);
    assert(learnResA.statusCode === 200, 'GET Course A Learn Content returns 200');
    assert(learnResA.data.data.summary.totalLessons === 6, 'Learn Content summary has totalLessons = 6');
    assert(learnResA.data.data.summary.completedLessons === 2, 'Learn Content summary has completedLessons = 2');
    assert(learnResA.data.data.summary.completedLessonIds.length === 2, 'Learn Content summary has 2 completedLessonIds');
    assert(learnResA.data.data.summary.studyTimeSeconds === 1800, 'Learn Content summary has studyTimeSeconds = 1800');

    console.log('\n🎉 ALL COURSE ISOLATION, PERSISTENCE & AUTHORIZATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    console.log('\n🧹 Cleaning up test data...');
    if (student1User) await User.deleteOne({ _id: student1User._id });
    if (student1) await Student.deleteOne({ _id: student1._id });
    if (student2User) await User.deleteOne({ _id: student2User._id });
    if (student2) await Student.deleteOne({ _id: student2._id });
    if (courseA) {
      await Course.deleteOne({ _id: courseA._id });
      await LessonProgress.deleteMany({ courseId: courseA._id });
      await CourseProgress.deleteMany({ courseId: courseA._id });
    }
    if (courseB) {
      await Course.deleteOne({ _id: courseB._id });
      await LessonProgress.deleteMany({ courseId: courseB._id });
      await CourseProgress.deleteMany({ courseId: courseB._id });
    }
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runCourseIsolationAndPersistenceTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
