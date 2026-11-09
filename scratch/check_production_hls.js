const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;

    // Check courses
    const courses = await db.collection('courses').find({}).toArray();
    let hlsCount = 0;
    for (const c of courses) {
      for (const m of (c.modules || [])) {
        for (const l of (m.lessons || [])) {
          if (l.hlsConversionStatus || l.hlsMasterUrl) {
            hlsCount++;
            console.log('Found Lesson HLS:', {
              courseId: c.courseId,
              title: l.lessonTitle,
              status: l.hlsConversionStatus,
              url: l.hlsMasterUrl,
              s3Key: l.s3Key || l.videoS3Key,
            });
          }
          for (const vp of (l.videoParts || [])) {
            if (vp.hlsConversionStatus || vp.hlsMasterUrl) {
              hlsCount++;
              console.log('Found Part HLS:', {
                courseId: c.courseId,
                title: vp.title,
                status: vp.hlsConversionStatus,
                url: vp.hlsMasterUrl,
                s3Key: vp.s3Key,
              });
            }
          }
        }
      }
    }
    console.log(`Total HLS lessons/parts in courses: ${hlsCount}`);

    // Check recordings
    const recordings = await db.collection('recordings').find({
      $or: [
        { hlsConversionStatus: { $exists: true } },
        { hlsMasterUrl: { $exists: true } },
      ]
    }).toArray();
    console.log(`Total HLS recordings: ${recordings.length}`);
    for (const r of recordings) {
      console.log('Recording HLS:', {
        id: r._id,
        title: r.lessonTitle,
        status: r.hlsConversionStatus,
        url: r.hlsMasterUrl,
        s3Key: r.s3Key,
      });
    }

    // Check DemoVideos
    const demoVideos = await db.collection('demovideos').find({
      $or: [
        { hlsConversionStatus: { $exists: true } },
        { hlsMasterUrl: { $exists: true } },
      ]
    }).toArray();
    console.log(`Total HLS demo videos: ${demoVideos.length}`);
    for (const d of demoVideos) {
      console.log('Demo Video HLS:', {
        id: d._id,
        title: d.title,
        status: d.hlsConversionStatus,
        url: d.hlsMasterUrl,
        s3Key: d.s3Key,
      });
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();

