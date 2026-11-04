const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testCurriculum() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Find student enrolled in AIAPGET or COMBO
  const student = await mongoose.connection.db.collection('students').findOne({ email: 'shekathannani@gmail.com' });
  const user = await mongoose.connection.db.collection('users').findOne({ email: 'shekathannani@gmail.com' });
  console.log('Student:', student?.email, student?.courseId, student?.courseIds);
  console.log('User:', user?.email, user?._id);

  const admin = await mongoose.connection.db.collection('users').findOne({ role: 'admin' });
  const token = jwt.sign(
    {
      id: admin._id.toString(),
      email: admin.email,
      role: 'admin',
    },
    process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure',
    { expiresIn: '1d' }
  );

  console.log('\n--- Fetching AIAPGET (CRS-000040) from Render ---');
  const res = await fetch(`https://homeopathybackend-1.onrender.com/api/student/courses/CRS-000040/learn`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('data keys:', Object.keys(data));
  if (data.data) console.log('data.data keys:', Object.keys(data.data));
  const course = data.course || data.data?.course || data.data || data;
  console.log('Course Title:', course.courseTitle || course.title, 'Modules:', course.modules?.length);
  for (const m of course.modules || []) {
    console.log('Module:', m.moduleName || m.name, 'Lessons:', m.lessons?.length);
    for (const l of m.lessons || []) {
      console.log(' - Lesson:', l.lessonTitle, 's3Key:', l.s3Key, 'videoFormat:', l.videoFormat);
      if (l.videoParts?.length) {
        console.log('   videoParts:', l.videoParts.map(vp => ({ fileName: vp.fileName, s3Key: vp.s3Key, mp4S3Key: vp.mp4S3Key, mp4Url: vp.mp4Url ? 'YES' : 'NO' })));
      }
    }
  }

  console.log('\n--- Fetching COMBO COURSE (CRS-000070) from Render ---');
  const res2 = await fetch(`https://homeopathybackend-1.onrender.com/api/student/courses/CRS-000070/learn`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Status:', res2.status);
  const data2 = await res2.json();
  const course2 = data2.course || data2.data?.course || data2.data || data2;
  console.log('Course Title:', course2.courseTitle || course2.title, 'Modules:', course2.modules?.length);
  for (const m of course2.modules || []) {
    console.log('Module:', m.moduleName || m.name, 'Lessons:', m.lessons?.length);
    for (const l of m.lessons || []) {
      console.log(' - Lesson:', l.lessonTitle, 's3Key:', l.s3Key, 'videoFormat:', l.videoFormat);
      if (l.videoParts?.length) {
        console.log('   videoParts:', l.videoParts.map(vp => ({ fileName: vp.fileName, s3Key: vp.s3Key, mp4S3Key: vp.mp4S3Key, mp4Url: vp.mp4Url ? 'YES' : 'NO' })));
      }
    }
  }
  await mongoose.disconnect();
}

testCurriculum().catch(console.error);
