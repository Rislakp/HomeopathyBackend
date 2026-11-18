const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).toArray();

  console.log(`TOTAL COURSES: ${courses.length}`);
  for (const c of courses) {
    console.log(`\n======================================================`);
    console.log(`COURSE: "${c.title || c.courseTitle}" (id: ${c._id})`);
    for (const m of c.modules || []) {
      console.log(`  MODULE: "${m.title || m.moduleName}" (id: ${m._id})`);
      for (const l of m.lessons || []) {
        console.log(`    LESSON: "${l.lessonTitle || l.title}" [id: ${l._id}] (${l.lessonType})`);
        console.log(`      meetingUrl: ${JSON.stringify(l.meetingUrl)}`);
        console.log(`      videoUrl: ${JSON.stringify(l.videoUrl)}`);
        console.log(`      s3Key: ${JSON.stringify(l.s3Key)}`);
        console.log(`      videoS3Key: ${JSON.stringify(l.videoS3Key)}`);
        console.log(`      mediaUrlOrPath: ${JSON.stringify(l.mediaUrlOrPath)}`);
        console.log(`      fileUrl: ${JSON.stringify(l.fileUrl)}`);
        console.log(`      documentUrl: ${JSON.stringify(l.documentUrl)}`);
        console.log(`      url: ${JSON.stringify(l.url)}`);
        console.log(`      videoParts: ${(l.videoParts || []).length} items`);
        for (const vp of l.videoParts || []) {
          console.log(`        -> vp: id=${vp._id}, title="${vp.title}", url="${vp.url}", s3Key="${vp.s3Key}"`);
        }
      }
    }
  }

  await mongoose.disconnect();
}

run();

