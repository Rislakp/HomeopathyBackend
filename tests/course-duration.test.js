const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  parseDurationMinutes,
  parseLessonDuration,
  calculateCourseTotalDurationMinutes,
} = require('../utils/courseDurationHelper');
const Course = require('../models/Course');
const courseController = require('../controllers/courseController');
const {
  formatCourseForStudent,
  buildProgressSummary,
} = require('../controllers/studentCurriculumController');

test('1. parseDurationMinutes correctly parses standard duration strings and plain numbers', () => {
  // Minutes
  assert.equal(parseDurationMinutes('90 mins'), 90);
  assert.equal(parseDurationMinutes('50 min'), 50);
  assert.equal(parseDurationMinutes('50 miin'), 50);
  assert.equal(parseDurationMinutes('45m'), 45);
  assert.equal(parseDurationMinutes('10 minute'), 10);
  assert.equal(parseDurationMinutes('15 minutes'), 15);
  assert.equal(parseDurationMinutes(' 30 MINS '), 30);

  // Hours
  assert.equal(parseDurationMinutes('1 hr'), 60);
  assert.equal(parseDurationMinutes('2 hrs'), 120);
  assert.equal(parseDurationMinutes('1.5 hours'), 90);
  assert.equal(parseDurationMinutes('0.5h'), 30);

  // Seconds
  assert.equal(parseDurationMinutes('2400 sec'), 40);
  assert.equal(parseDurationMinutes('120s'), 2);
  assert.equal(parseDurationMinutes('300 seconds'), 5);

  // Clock format
  assert.equal(parseDurationMinutes('01:30:00'), 90);
  assert.equal(parseDurationMinutes('45:00'), 45);
  assert.equal(parseDurationMinutes('00:30'), 1);

  // Plain numbers (Admin Portal "Duration (mins)" field)
  assert.equal(parseDurationMinutes('50'), 50);
  assert.equal(parseDurationMinutes('10'), 10);
  assert.equal(parseDurationMinutes(60), 60);
});

test('2. parseDurationMinutes safely handles edge cases, negative numbers, pages, and invalid input', () => {
  // Page counts (PDF notes, assignments) must return 0
  assert.equal(parseDurationMinutes('12 pages'), 0);
  assert.equal(parseDurationMinutes('1 page'), 0);
  assert.equal(parseDurationMinutes('24 pages'), 0);

  // Missing, null, undefined, empty
  assert.equal(parseDurationMinutes(null), 0);
  assert.equal(parseDurationMinutes(undefined), 0);
  assert.equal(parseDurationMinutes(''), 0);
  assert.equal(parseDurationMinutes('   '), 0);

  // Invalid strings
  assert.equal(parseDurationMinutes('abc'), 0);
  assert.equal(parseDurationMinutes('invalid'), 0);

  // Negative numbers
  assert.equal(parseDurationMinutes(-10), 0);
  assert.equal(parseDurationMinutes('-10 mins'), 0);
  assert.equal(parseDurationMinutes('-5'), 0);

  // Fallback to videoDuration in seconds
  assert.equal(parseDurationMinutes('', 1800), 30);
  assert.equal(parseDurationMinutes(null, 3600), 60);
  assert.equal(parseDurationMinutes(undefined, 7200), 120);
});

test('3. parseLessonDuration parses duration from lesson object and falls back to video metadata', () => {
  // Primary durationOrPages
  const lessonWithMins = {
    lessonTitle: 'Pharmacy Lecture',
    durationOrPages: '90 mins',
    videoDuration: 0,
  };
  assert.equal(parseLessonDuration(lessonWithMins), 90);

  // Plain numeric durationOrPages
  const lessonWithNum = {
    lessonTitle: 'Clinical Session',
    durationOrPages: '50',
    videoDuration: 0,
  };
  assert.equal(parseLessonDuration(lessonWithNum), 50);

  // Fallback to videoDuration in seconds
  const lessonWithVideoSec = {
    lessonTitle: 'Recorded Surgery',
    durationOrPages: '',
    videoDuration: 3600,
  };
  assert.equal(parseLessonDuration(lessonWithVideoSec), 60);

  // Fallback to videoParts duration
  const lessonWithVideoParts = {
    lessonTitle: 'Multi-part Demo',
    durationOrPages: '',
    videoDuration: 0,
    videoParts: [
      { duration: 1800 },
      { duration: 1800 },
    ],
  };
  assert.equal(parseLessonDuration(lessonWithVideoParts), 60);

  // Document lesson with pages count
  const lessonWithPages = {
    lessonTitle: 'Reading Handout',
    durationOrPages: '24 pages',
    videoDuration: 0,
  };
  assert.equal(parseLessonDuration(lessonWithPages), 0);
});

test('4. calculateCourseTotalDurationMinutes sums multiple modules and lessons accurately', () => {
  const course = {
    courseId: 'CRS-TEST-01',
    courseTitle: 'Comprehensive Homeopathy',
    modules: [
      {
        moduleName: 'Module 1 - Foundations',
        lessons: [
          { lessonTitle: 'Intro', durationOrPages: '90 mins' },
          { lessonTitle: 'History', durationOrPages: '50 mins' },
        ],
      },
      {
        moduleName: 'Module 2 - Materia Medica',
        lessons: [
          { lessonTitle: 'Remedies Part 1', durationOrPages: '120 mins' },
          { lessonTitle: 'Remedies Part 2', durationOrPages: '60 min' },
          { lessonTitle: 'Handout PDF', durationOrPages: '15 pages' },
        ],
      },
      {
        moduleName: 'Module 3 - Case Studies',
        lessons: [
          { lessonTitle: 'Live Review', durationOrPages: '40' },
          { lessonTitle: 'Video Case', durationOrPages: '', videoDuration: 2400 }, // 40 mins fallback
        ],
      },
    ],
  };

  // Expected: 90 + 50 + 120 + 60 + 0 + 40 + 40 = 400 minutes
  const total = calculateCourseTotalDurationMinutes(course);
  assert.equal(total, 400);
});

test('5. calculateCourseTotalDurationMinutes handles empty course, zero duration, and missing fields', () => {
  // Null/undefined course
  assert.equal(calculateCourseTotalDurationMinutes(null), 0);
  assert.equal(calculateCourseTotalDurationMinutes(undefined), 0);

  // Course with no modules
  assert.equal(calculateCourseTotalDurationMinutes({ courseTitle: 'Empty Course', modules: [] }), 0);

  // Course with modules having no lessons
  assert.equal(calculateCourseTotalDurationMinutes({
    courseTitle: 'Empty Modules',
    modules: [{ moduleName: 'Mod 1', lessons: [] }, { moduleName: 'Mod 2', lessons: [] }],
  }), 0);

  // Course with lessons that have null or empty durations
  assert.equal(calculateCourseTotalDurationMinutes({
    courseTitle: 'Null Durations',
    modules: [
      {
        moduleName: 'Mod 1',
        lessons: [
          { lessonTitle: 'L1', durationOrPages: null },
          { lessonTitle: 'L2', durationOrPages: '' },
          { lessonTitle: 'L3', durationOrPages: '0' },
        ],
      },
    ],
  }), 0);
});

test('6. calculateCourseTotalDurationMinutes avoids double-counting between modules and lessons', () => {
  const courseWithBoth = {
    courseTitle: 'Avoid Double Count',
    modules: [
      {
        moduleName: 'Module With Lessons and Module Duration',
        duration: '120 mins', // Module-level total
        lessons: [
          { lessonTitle: 'L1', durationOrPages: '40 mins' },
          { lessonTitle: 'L2', durationOrPages: '20 mins' },
        ],
      },
    ],
  };

  // Must only count lessons (40 + 20 = 60), NOT 60 + 120 = 180!
  assert.equal(calculateCourseTotalDurationMinutes(courseWithBoth), 60);

  // Fallback: If module has NO lessons, use module-level duration
  const courseWithModuleOnly = {
    courseTitle: 'Module Only',
    modules: [
      {
        moduleName: 'Module Without Lessons',
        duration: '75 mins',
        lessons: [],
      },
    ],
  };
  assert.equal(calculateCourseTotalDurationMinutes(courseWithModuleOnly), 75);
});

test('7. Course isolation: calculations are strictly scoped to the target course', () => {
  const courseA = {
    courseId: 'COURSE_A',
    modules: [
      {
        moduleName: 'Mod A',
        lessons: [{ lessonTitle: 'Lesson A1', durationOrPages: '90 mins' }],
      },
    ],
  };

  const courseB = {
    courseId: 'COURSE_B',
    modules: [
      {
        moduleName: 'Mod B',
        lessons: [{ lessonTitle: 'Lesson B1', durationOrPages: '30 mins' }],
      },
    ],
  };

  const totalA = calculateCourseTotalDurationMinutes(courseA);
  const totalB = calculateCourseTotalDurationMinutes(courseB);

  assert.equal(totalA, 90, 'Course A duration is 90 mins');
  assert.equal(totalB, 30, 'Course B duration is 30 mins');
  assert.notEqual(totalA, totalB, 'Courses remain strictly isolated');
});

test('8. Mongoose Course model includes totalDurationMinutes virtual in toObject() and toJSON()', () => {
  const courseDoc = new Course({
    courseTitle: 'Virtual Test Course',
    instructor: 'Dr. Test',
    price: 999,
    modules: [
      {
        moduleName: 'Virtual Mod 1',
        lessons: [
          { lessonTitle: 'Lesson 1', durationOrPages: '45 mins' },
          { lessonTitle: 'Lesson 2', durationOrPages: '15 mins' },
        ],
      },
    ],
  });

  assert.equal(courseDoc.totalDurationMinutes, 60, 'Virtual property returns 60');

  const obj = courseDoc.toObject({ virtuals: true });
  assert.equal(obj.totalDurationMinutes, 60, 'toObject({ virtuals: true }) includes totalDurationMinutes: 60');

  const json = JSON.parse(JSON.stringify(courseDoc));
  assert.equal(json.totalDurationMinutes, 60, 'toJSON includes totalDurationMinutes: 60');
});

test('9. courseController.serializeCourse attaches totalDurationMinutes', async () => {
  const mockCourse = {
    _id: new mongoose.Types.ObjectId(),
    courseId: 'CRS-MOCK-01',
    courseTitle: 'Serialized Course',
    modules: [
      {
        _id: new mongoose.Types.ObjectId(),
        moduleName: 'Serialized Mod',
        lessons: [
          {
            _id: new mongoose.Types.ObjectId(),
            lessonTitle: 'L1',
            durationOrPages: '75 mins',
          },
        ],
      },
    ],
  };

  const serialized = await courseController.serializeCourse(mockCourse);
  assert.equal(serialized.totalDurationMinutes, 75, 'serializeCourse contains totalDurationMinutes: 75');
});

test('10. studentCurriculumController formatCourseForStudent and buildProgressSummary include totalDurationMinutes', () => {
  const course = {
    _id: new mongoose.Types.ObjectId(),
    courseId: 'CRS-STUDENT-01',
    courseTitle: 'Student Course',
    modules: [
      {
        _id: new mongoose.Types.ObjectId(),
        moduleName: 'Student Mod',
        lessons: [
          {
            _id: new mongoose.Types.ObjectId(),
            lessonTitle: 'Lesson 1',
            durationOrPages: '50 mins',
          },
          {
            _id: new mongoose.Types.ObjectId(),
            lessonTitle: 'Lesson 2',
            durationOrPages: '30 mins',
          },
        ],
      },
    ],
  };

  // formatCourseForStudent
  const formatted = formatCourseForStudent(course);
  assert.equal(formatted.totalDurationMinutes, 80, 'formatCourseForStudent attached totalDurationMinutes: 80');

  // buildProgressSummary
  const summary = buildProgressSummary(course, [], 0);
  assert.equal(summary.totalDurationMinutes, 80, 'buildProgressSummary contains totalDurationMinutes: 80');
});

test('11. courseController.getCourseById returns totalDurationMinutes in API response payload', async (t) => {
  const originalFindOne = Course.findOne;
  t.after(() => {
    Course.findOne = originalFindOne;
  });

  const sampleCourse = {
    _id: new mongoose.Types.ObjectId(),
    courseId: 'CRS-TEST-100',
    courseTitle: 'Full Course Test',
    instructor: 'Faculty Expert',
    price: 4999,
    modules: [
      {
        _id: new mongoose.Types.ObjectId(),
        moduleName: 'Module A',
        lessons: [
          { _id: new mongoose.Types.ObjectId(), lessonTitle: 'Lecture 1', durationOrPages: '60 mins' },
          { _id: new mongoose.Types.ObjectId(), lessonTitle: 'Lecture 2', durationOrPages: '45 mins' },
        ],
      },
      {
        _id: new mongoose.Types.ObjectId(),
        moduleName: 'Module B',
        lessons: [
          { _id: new mongoose.Types.ObjectId(), lessonTitle: 'Lecture 3', durationOrPages: '15' },
        ],
      },
    ],
    toObject() {
      return { ...this };
    },
  };

  Course.findOne = () => Promise.resolve(sampleCourse);

  const req = {
    params: { id: sampleCourse.courseId },
    user: { role: 'student' },
  };

  let responseData = null;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      responseData = body;
      return this;
    },
  };

  await courseController.getCourseById(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(responseData, 'Received response payload');
  assert.equal(responseData.success, true);
  // Total = 60 + 45 + 15 = 120 minutes
  assert.equal(responseData.data.totalDurationMinutes, 120, 'responseData.data.totalDurationMinutes is 120');
  assert.equal(responseData.course.totalDurationMinutes, 120, 'responseData.course.totalDurationMinutes is 120');
});
