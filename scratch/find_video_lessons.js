require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const courses = await db.collection("courses").find({}).toArray();
  for (const c of courses) {
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        const title = (l.lessonTitle || l.title || '').toLowerCase();
        if (title.includes('video') || title.includes('pharmacy')) {
          console.log(`Course: ${c.courseId} (${c.courseTitle || c.title}) -> Module: "${m.moduleName || m.title}" -> Lesson: "${l.lessonTitle || l.title}" (id: ${l._id})`);
        }
      }
    }
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
