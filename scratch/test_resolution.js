const mongoose = require('mongoose');
require('dotenv').config();
const { verifyStudentCourseAccess, verifyStudentCourseAccessAny } = require('../utils/courseAccessHelper');

async function testResolution() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));

  const student = await Student.findOne({ email: 'thunnarantheweavingbird@gmail.com' }).lean();
  console.log('Test Student:', student.name, 'Enrolled CourseId:', student.courseId);

  const reqUser = {
    id: student.userId || student._id.toString(),
    userId: student.userId || student._id.toString(),
    studentId: student._id.toString(),
    email: student.email,
    role: 'student'
  };

  const keys = [
    'videos/1791088299310-028d42b0-172e-4243-bdab-8b03e4b8332e-pharmacy-1.mp4',
    'pdfs/1791954639400-348c046e-8d79-44a7-8818-1bcfb1c019eb-PHARMACY-NOTE.pdf',
    'pdfs/1791375394654-55f4eb12-7b22-4f11-b31a-b7e8f63c2f98-Pharmacy-OCT-6.pdf',
    'pdfs/1791091529068-2e0b108a-3018-4043-8cdb-c30df7e5b420-ASST-PHARMACY.pdf'
  ];

  for (const key of keys) {
    console.log('\n--- Testing Key:', key);
    // Find all courses containing this key
    const allMatchingCourses = await Course.find({
      $or: [
        { 'modules.lessons.videoS3Key': key },
        { 'modules.lessons.s3Key': key },
        { 'modules.lessons.videoParts.s3Key': key },
        { 'modules.lessons.pdfNotes.s3Key': key },
        { 'modules.lessons.attachments.s3Key': key },
        { 'modules.lessons.taskWorksheets.s3Key': key },
      ]
    }).select('_id courseId courseTitle').lean();

    console.log('Matching courses count:', allMatchingCourses.length);
    for (const c of allMatchingCourses) {
      console.log('  Course:', c.courseId, '|', c.courseTitle, 'Access?', await verifyStudentCourseAccess(reqUser, c.courseId));
    }

    const candidateIds = allMatchingCourses.map(c => c.courseId || c._id.toString());
    const hasAnyAccess = await verifyStudentCourseAccessAny(reqUser, candidateIds);
    console.log('  -> verifyStudentCourseAccessAny result:', hasAnyAccess);
  }

  await mongoose.disconnect();
}

testResolution().catch(console.error);
