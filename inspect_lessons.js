const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).toArray();

  for (const c of courses) {
    console.log(`\n========================================`);
    console.log(`COURSE: "${c.title}" [id: ${c._id}]`);
    console.log(`Course Demo Video: ${c.demoVideoUrl || c.demoVideoS3Key || 'none'}`);
    if (!c.modules || c.modules.length === 0) {
      console.log('  No modules');
      continue;
    }
    for (const m of c.modules) {
      console.log(`  MODULE: "${m.title}" [id: ${m._id}]`);
      if (!m.lessons || m.lessons.length === 0) {
        console.log('    No lessons');
        continue;
      }
      for (const l of m.lessons) {
        console.log(`    LESSON: "${l.lessonTitle}" [id: ${l._id}] | Type: "${l.lessonType}"`);
        console.log(`      meetingUrl: "${l.meetingUrl}"`);
        console.log(`      videoUrl: "${l.videoUrl}"`);
        console.log(`      s3Key: "${l.s3Key}" | videoS3Key: "${l.videoS3Key}"`);
        console.log(`      fileUrl: "${l.fileUrl}" | documentUrl: "${l.documentUrl}" | url: "${l.url}"`);
        if (l.videoParts && l.videoParts.length > 0) {
          console.log(`      videoParts: count = ${l.videoParts.length}`);
          l.videoParts.forEach((vp, idx) => {
            console.log(`        Part ${idx+1}: [id: ${vp._id}] title="${vp.title}" url="${vp.url}" s3Key="${vp.s3Key}" secure_url="${vp.secure_url}" fileName="${vp.fileName}"`);
          });
        } else {
          console.log(`      videoParts: NONE`);
        }
      }
    }
  }

  await mongoose.disconnect();
}

run();

