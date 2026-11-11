const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function inspectRemainingCourses() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({
    courseId: { $in: ['CRS-000081', 'CRS-000082', 'CRS-000083'] }
  }).toArray();

  for (const c of courses) {
    console.log(`Course: ${c.courseId} - ${c.title || c.courseTitle}`);
    console.log('Modules:', JSON.stringify(c.modules, null, 2));
  }

  await mongoose.disconnect();
}

inspectRemainingCourses().catch(console.error);
