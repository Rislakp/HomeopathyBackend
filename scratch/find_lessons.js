require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require("mongoose");

async function run() {
  const uri = process.env.MONGODB_URI;
  console.log("Connecting to:", uri);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const courses = await db.collection("courses").find({}).toArray();
  console.log("Total courses:", courses.length);
  for (const c of courses) {
    let hasLesson = false;
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        hasLesson = true;
        console.log(`[${c.courseId || c._id}] [${c.title}] -> [${m.title}] Lesson: "${l.title}" (id: ${l._id || l.id}) type: ${l.type} s3Key: "${l.s3Key || ''}" videoUrl: "${l.videoUrl || ''}" parts: ${l.videoParts ? l.videoParts.length : 0}`);
        if (l.videoParts && l.videoParts.length > 0) {
          console.log(`   VideoParts: ${JSON.stringify(l.videoParts)}`);
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
