const mongoose = require('mongoose');
require('dotenv').config();

async function checkStudents() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
  const Course = mongoose.model('Course', new mongoose.Schema({}, { strict: false }));
  const combo = await Course.findOne({ courseId: 'CRS-000070' });
  console.log('Combo ID:', combo._id);
  const students = await Student.find({
    $or: [
      { courseId: 'CRS-000070' },
      { courseId: combo._id.toString() },
      { courseRef: combo._id },
      { courseIds: 'CRS-000070' },
      { courseIds: combo._id.toString() },
      { courseIds: combo._id },
      { course: 'CRS-000070' },
      { course: 'COMBO COURSE' }
    ]
  }).select('name email courseId courseIds status subscription subscriptionStatus').lean();

  console.log('Found students enrolled in COMBO COURSE:', students.length);
  for (const s of students) {
    console.log('  Student:', s.name, '|', s.email, '| status:', s.status, '| courseId:', s.courseId, '| courseIds:', s.courseIds);
  }
  await mongoose.disconnect();
}
checkStudents().catch(console.error);
