const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const all = await db.collection('courses').find({}).toArray();
  for (const c of all) {
    for (const m of c.modules || []) {
      if (m._id.toString() === "6aec50edda5f79e44013789f") {
        console.log("Matched Course:", c._id, c.title, "Module:", m.title);
        for (const l of m.lessons || []) {
          console.log(`  Lesson [${l._id}]: "${l.lessonTitle}" (${l.lessonType})`);
          console.log(`    meetingUrl: "${l.meetingUrl}"`);
          console.log(`    videoUrl: "${l.videoUrl}"`);
          console.log(`    s3Key: "${l.s3Key}" | videoS3Key: "${l.videoS3Key}"`);
          console.log(`    videoParts:`, JSON.stringify(l.videoParts));
        }
      }
    }
  }

  await mongoose.disconnect();
}
run();

