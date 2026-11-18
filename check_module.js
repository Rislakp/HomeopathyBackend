const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const course = await db.collection('courses').findOne({ _id: new mongoose.Types.ObjectId("6ac0ef52bce3dc3b2f5fa37f") });
  if (course) {
    console.log("Found Course:", course.title || course.courseTitle);
    const mod = (course.modules || []).find(m => m._id.toString() === "6ac640b6ed6d8ba441a19ebb");
    if (mod) {
      console.log("Found Module:", mod.title || mod.moduleTitle);
      for (const l of mod.lessons || []) {
        console.log("  Lesson:", l._id, l.lessonTitle, l.lessonType, "meetingUrl:", l.meetingUrl, "videoUrl:", l.videoUrl, "s3Key:", l.s3Key, "videoParts:", JSON.stringify(l.videoParts));
      }
    } else {
      console.log("Module not found in course. Listing course modules:");
      for (const m of course.modules || []) {
        console.log("  Module:", m._id, m.title);
      }
    }
  } else {
    console.log("Course 6ac0ef52bce3dc3b2f5fa37f not found directly. Searching all courses...");
    const all = await db.collection('courses').find({}).toArray();
    for (const c of all) {
      for (const m of c.modules || []) {
        if (m._id.toString() === "6ac640b6ed6d8ba441a19ebb") {
          console.log("Matched in course:", c._id, c.title, "Module:", m.title);
          for (const l of m.lessons || []) {
            console.log("  Lesson:", l._id, l.lessonTitle, l.lessonType, "meetingUrl:", l.meetingUrl, "videoUrl:", l.videoUrl, "s3Key:", l.s3Key, "videoParts:", JSON.stringify(l.videoParts));
          }
        }
      }
    }
  }

  await mongoose.disconnect();
}
run();

