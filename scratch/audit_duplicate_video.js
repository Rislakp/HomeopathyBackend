const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function audit() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('\n=== 1. SEARCHING COURSES FOR LESSONS NAMED "video" OR "video2" OR CONTAINING "PHARMACY-4" ===');
  const courses = await db.collection('courses').find({}).toArray();
  
  let foundCourses = [];

  for (const c of courses) {
    let matchedLessons = [];
    if (Array.isArray(c.modules)) {
      for (const m of c.modules) {
        if (Array.isArray(m.lessons)) {
          for (const l of m.lessons) {
            const title = (l.lessonTitle || l.title || l.name || '').toLowerCase();
            const s3Key = (l.videoS3Key || l.s3Key || '').toLowerCase();
            const vpKeys = (l.videoParts || []).map(vp => (vp.s3Key || vp.url || '').toLowerCase()).join(' ');
            if (title === 'video' || title === 'video2' || title.includes('video') || s3Key.includes('pharmacy-4') || vpKeys.includes('pharmacy-4')) {
              matchedLessons.push({
                moduleId: m._id || m.id,
                moduleTitle: m.moduleTitle || m.title || m.moduleName,
                lessonId: l._id || l.id,
                lessonTitle: l.lessonTitle || l.title,
                lessonType: l.lessonType || l.type,
                videoUrl: l.videoUrl,
                s3Key: l.s3Key,
                videoS3Key: l.videoS3Key,
                videoParts: l.videoParts,
                videoMedia: l.videoMedia,
                recordingId: l.recordingId,
                contentItems: l.contentItems,
              });
            }
          }
        }
      }
    }
    if (matchedLessons.length > 0) {
      foundCourses.push({
        _id: c._id,
        courseId: c.courseId,
        title: c.courseTitle || c.title,
        status: c.status,
        matchedLessons,
      });
    }
  }

  console.log(`Found ${foundCourses.length} course(s) with matched lessons:`);
  for (const fc of foundCourses) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Course ID: ${fc._id} | Custom ID: ${fc.courseId} | Title: "${fc.title}" | Status: ${fc.status}`);
    console.log(`Matched lessons (${fc.matchedLessons.length}):`);
    for (const ml of fc.matchedLessons) {
      console.log(`  Module ID: ${ml.moduleId} ("${ml.moduleTitle}")`);
      console.log(`  Lesson ID: ${ml.lessonId} | Title: "${ml.lessonTitle}" | Type: ${ml.lessonType}`);
      console.log(`  lesson.s3Key: ${ml.s3Key}`);
      console.log(`  lesson.videoS3Key: ${ml.videoS3Key}`);
      console.log(`  lesson.videoUrl: ${ml.videoUrl}`);
      console.log(`  lesson.recordingId: ${ml.recordingId}`);
      console.log(`  lesson.videoParts: ${JSON.stringify(ml.videoParts, null, 2)}`);
      if (ml.videoMedia) console.log(`  lesson.videoMedia: ${JSON.stringify(ml.videoMedia, null, 2)}`);
    }
  }

  console.log('\n=== 2. SEARCHING RECORDINGS COLLECTION FOR PHARMACY-4 ===');
  const recordings = await db.collection('recordings').find({
    $or: [
      { s3Key: { $regex: /pharmacy-4/i } },
      { videoUrl: { $regex: /pharmacy-4/i } },
      { title: { $regex: /pharmacy-4/i } },
      { originalFileName: { $regex: /pharmacy-4/i } },
    ]
  }).toArray();
  console.log(`Found ${recordings.length} recording(s):`);
  for (const r of recordings) {
    console.log(`  _id: ${r._id} | title: "${r.title}" | courseId: ${r.courseId} | moduleId: ${r.moduleId} | lessonId: ${r.lessonId}`);
    console.log(`  s3Key: ${r.s3Key} | videoUrl: ${r.videoUrl}`);
  }

  console.log('\n=== 3. SEARCHING LIVEREGARDS / LIVERECORDS FOR PHARMACY-4 ===');
  const liveRecords = await db.collection('liverecords').find({
    $or: [
      { s3Key: { $regex: /pharmacy-4/i } },
      { recordingFileUrl: { $regex: /pharmacy-4/i } },
      { title: { $regex: /pharmacy-4/i } },
    ]
  }).toArray();
  console.log(`Found ${liveRecords.length} liveRecord(s):`);
  for (const lr of liveRecords) {
    console.log(`  _id: ${lr._id} | title: "${lr.title}" | s3Key: ${lr.s3Key}`);
  }

  await mongoose.disconnect();
  console.log('\nAudit complete.');
}

audit().catch(console.error);
