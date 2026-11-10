const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const courses = await db.collection('courses').find({}).toArray();
  console.log(`Total courses in DB: ${courses.length}`);
  let count = 0;
  for (const c of courses) {
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        if (l.videoUrl || l.s3Key || (l.videoParts && l.videoParts.length > 0)) {
          count++;
          if (count <= 15) {
            console.log(`[${c.courseId}] Lesson: ${l.lessonTitle}`);
            console.log(`  videoUrl: ${l.videoUrl ? l.videoUrl.split('?')[0] : 'none'}`);
            console.log(`  s3Key: ${l.s3Key || l.videoS3Key || 'none'}`);
            console.log(`  hlsStatus: ${l.hlsConversionStatus || 'none'}, hlsMasterUrl: ${l.hlsMasterUrl || 'none'}`);
            if (l.videoParts && l.videoParts.length) {
              console.log(`  videoParts:`, l.videoParts.map(vp => ({
                title: vp.title,
                url: vp.url ? vp.url.split('?')[0] : 'none',
                s3Key: vp.s3Key,
                hlsStatus: vp.hlsConversionStatus,
                hlsUrl: vp.hlsMasterUrl,
              })));
            }
          }
        }
      }
    }
  }
  console.log(`Total lessons with video: ${count}`);
  await mongoose.disconnect();
}

run().catch(e => console.error(e));

