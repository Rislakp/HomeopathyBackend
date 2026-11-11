const mongoose = require("mongoose");

async function run() {
  try {
    await mongoose.connect("mongodb://localhost:27017/homeopathy_db", { serverSelectionTimeoutMS: 2000 });
    console.log("Connected to local DB!");
    const db = mongoose.connection.db;
    const courses = await db.collection("courses").find({}).toArray();
    console.log("Local courses count:", courses.length);
    for (const c of courses) {
      for (const m of (c.modules || [])) {
        for (const l of (m.lessons || [])) {
          const title = (l.lessonTitle || l.title || '').toLowerCase();
          if (title.includes('video') || title.includes('pharmacy')) {
            console.log(`Local Course: ${c.courseId} (${c.courseTitle || c.title}) -> Mod: "${m.moduleName || m.title}" -> Lesson: "${l.lessonTitle || l.title}" (id: ${l._id})`);
          }
        }
      }
    }
  } catch (err) {
    console.log("Local DB not available or error:", err.message);
  }
  process.exit(0);
}

run();
