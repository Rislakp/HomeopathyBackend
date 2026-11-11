const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function testLiveApi() {
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await mongoose.connection.db.collection('users').findOne({ role: 'admin' });
  const token = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: 'admin' },
    process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure',
    { expiresIn: '1d' }
  );

  console.log('Admin token generated.');

  const endpoints = [
    'https://api.whitecoat.academy/api/courses',
    'https://api.whitecoat.academy/api/student/courses',
  ];

  for (const ep of endpoints) {
    try {
      console.log(`\nFetching ${ep}...`);
      const res = await fetch(ep, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`Status: ${res.status}`);
      const body = await res.json();
      const courses = body.courses || body.data?.courses || body.data || [];
      console.log(`Returned ${courses.length} courses:`);
      for (const c of courses) {
        console.log(`  Course: "${c.courseTitle || c.title}" (courseId: ${c.courseId}, _id: ${c._id})`);
      }
    } catch (e) {
      console.error(`Error fetching ${ep}:`, e.message);
    }
  }

  // Also query CRS-000080 (Test) on live API!
  try {
    const testLearnUrl = 'https://api.whitecoat.academy/api/student/courses/CRS-000080/learn';
    console.log(`\nFetching ${testLearnUrl}...`);
    const res = await fetch(testLearnUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    const course = data.course || data.data?.course || data.data;
    console.log(`Course Title: "${course.courseTitle || course.title}" | Modules: ${course.modules?.length}`);
    for (const m of course.modules || []) {
      console.log(`  Module: "${m.moduleTitle || m.title || m.name}" (id: ${m._id})`);
      for (const l of m.lessons || []) {
        console.log(`    Lesson: "${l.lessonTitle || l.title || l.name}" (id: ${l._id})`);
        console.log(`      s3Key: ${l.s3Key}`);
        console.log(`      videoUrl: ${l.videoUrl ? l.videoUrl.substring(0, 60) + '...' : ''}`);
        console.log(`      videoParts: ${l.videoParts?.length}`);
        for (const vp of l.videoParts || []) {
          console.log(`        vp: "${vp.title}" s3Key: ${vp.s3Key} url: ${vp.url ? vp.url.substring(0, 50) + '...' : ''}`);
        }
      }
    }
  } catch (e) {
    console.error('Error fetching test course:', e.message);
  }

  await mongoose.disconnect();
}

testLiveApi().catch(console.error);
