require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const courses = await db.collection("courses").find({}).toArray();
  console.log("Total courses:", courses.length);
  for (const c of courses) {
    console.log(`Course [${c.courseId}] "${c.courseTitle || c.title}" (status: ${c.status})`);
    for (const m of (c.modules || [])) {
      console.log(`  Module: "${m.moduleName || m.title}"`);
      for (const l of (m.lessons || [])) {
        console.log(`    Lesson: "${l.lessonTitle || l.title}" (type: ${l.lessonType || l.type}, id: ${l._id})`);
        if (l.videoParts && l.videoParts.length) {
          console.log(`      VideoParts:`, l.videoParts.map(v => v.title || v.fileName || v.s3Key));
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
