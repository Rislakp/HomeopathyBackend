const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Exam = require('../models/Exam');
const Recording = require('../models/Recording');
const { getMyCourses } = require('../controllers/studentCurriculumController');
const { getAvailableExams } = require('../src/student/student.controller');
const { getRecordings } = require('../controllers/recordingController');

async function verifyCourseAwareness() {
  console.log('====================================================');
  console.log('  VERIFYING STRICT COURSE-AWARENESS ACROSS APIS');
  console.log('====================================================\n');

  const mockCourseId = new mongoose.Types.ObjectId();
  const mockStudent1Id = new mongoose.Types.ObjectId();
  const mockStudent2Id = new mongoose.Types.ObjectId();

  const mockCourse = {
    _id: mockCourseId,
    courseId: 'CRS-000039',
    courseTitle: 'Materia Medica 101',
    status: 'Published',
    modules: [],
    toObject: () => mockCourse,
  };

  const mockChain = (data) => ({
    select: () => mockChain(data),
    sort: () => mockChain(data),
    populate: () => mockChain(data),
    then: (resolve) => resolve(data),
  });

  // Mock DB finds
  const origCourseFind = Course.find;
  const origExamFind = Exam.find;
  const origRecordingFind = Recording.find;
  const origStudentFindOne = Student.findOne;
  const origStudentFindById = Student.findById;

  Course.find = () => mockChain([mockCourse]);
  Exam.find = () => mockChain([]);
  Recording.find = () => mockChain([]);
  Student.findOne = () => mockChain(null);
  Student.findById = () => mockChain(null);

  // 1. Verify Student WITH assigned course
  console.log('1. Testing Student WITH assigned courseId ("CRS-000039")...');
  const studentWithCourseReq = {
    user: {
      id: mockStudent1Id.toString(),
      role: 'student',
      courseId: 'CRS-000039',
      courseRef: mockCourseId.toString(),
      course: 'Materia Medica 101',
    },
  };

  let coursesStatus = 0;
  let coursesJson = null;
  const mockCoursesRes = {
    status: (code) => { coursesStatus = code; return mockCoursesRes; },
    json: (payload) => { coursesJson = payload; return mockCoursesRes; },
  };

  await getMyCourses(studentWithCourseReq, mockCoursesRes);

  if (coursesStatus !== 200 || !coursesJson || coursesJson.success !== true) {
    console.error('❌ getMyCourses failed for student with course:', coursesStatus, coursesJson);
    process.exit(1);
  }
  console.log(`✓ getMyCourses returned 200 OK with ${coursesJson.count} course(s).`);

  // 2. Verify Student WITHOUT assigned course (Unassigned student)
  console.log('\n2. Testing Student WITHOUT assigned course (Unassigned)...');
  const studentNoCourseReq = {
    user: {
      id: mockStudent2Id.toString(),
      role: 'student',
      courseId: '',
      courseRef: null,
      course: '',
    },
  };

  let unassignedStatus = 0;
  let unassignedJson = null;
  const mockUnassignedRes = {
    status: (code) => { unassignedStatus = code; return mockUnassignedRes; },
    json: (payload) => { unassignedJson = payload; return mockUnassignedRes; },
  };

  await getMyCourses(studentNoCourseReq, mockUnassignedRes);

  if (unassignedStatus !== 404 || !unassignedJson || unassignedJson.success !== false) {
    console.error('❌ Expected unassigned student to receive 404 error, but got:', unassignedStatus, unassignedJson);
    process.exit(1);
  }
  console.log(`✓ getMyCourses correctly returned 404 Not Found for unassigned student.`);
  console.log(`  Message: "${unassignedJson.message}"`);

  // 3. Verify getAvailableExams for unassigned student
  console.log('\n3. Testing getAvailableExams for unassigned student...');
  let examsStatus = 0;
  let examsJson = null;
  const mockExamsRes = {
    status: (code) => { examsStatus = code; return mockExamsRes; },
    json: (payload) => { examsJson = payload; return mockExamsRes; },
  };

  await getAvailableExams(studentNoCourseReq, mockExamsRes);

  if (examsStatus !== 404 || !examsJson || examsJson.success !== false) {
    console.error('❌ Expected getAvailableExams for unassigned student to return 404, got:', examsStatus, examsJson);
    process.exit(1);
  }
  console.log(`✓ getAvailableExams correctly returned 404 Not Found for unassigned student.`);

  // 4. Verify getRecordings for unassigned student
  console.log('\n4. Testing getRecordings for unassigned student...');
  let recStatus = 0;
  let recJson = null;
  const mockRecRes = {
    status: (code) => { recStatus = code; return mockRecRes; },
    json: (payload) => { recJson = payload; return mockRecRes; },
  };

  await getRecordings(studentNoCourseReq, mockRecRes);

  if (recStatus !== 404 || !recJson || recJson.success !== false) {
    console.error('❌ Expected getRecordings for unassigned student to return 404, got:', recStatus, recJson);
    process.exit(1);
  }
  console.log(`✓ getRecordings correctly returned 404 Not Found for unassigned student.`);

  // Restore DB finds
  Course.find = origCourseFind;
  Exam.find = origExamFind;
  Recording.find = origRecordingFind;
  Student.findOne = origStudentFindOne;
  Student.findById = origStudentFindById;

  console.log('\n====================================================');
  console.log('🎉 ALL COURSE-AWARENESS VERIFICATION CHECKS PASSED!');
  console.log('====================================================');
}

verifyCourseAwareness().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
