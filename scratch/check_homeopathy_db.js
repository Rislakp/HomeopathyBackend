const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkHomeopathyDb() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.client.db('homeopathy_db');
  const courses = await db.collection('courses').find({}).toArray();
  console.log(`homeopathy_db courses count: ${courses.length}`);
  for (const c of courses) {
    console.log(`Course: "${c.courseTitle || c.title}" (${c.courseId})`);
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        console.log(`  Lesson: "${l.lessonTitle || l.title}"`);
      }
    }
  }
  await mongoose.disconnect();
}

checkHomeopathyDb().catch(console.error);
