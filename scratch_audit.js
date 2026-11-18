const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  console.log('=== COURSES & LESSONS ===');
  const courses = await db.collection('courses').find({}, { 
    projection: { 
      title: 1, 
      'modules.title': 1, 
      'modules.lessons._id': 1,
      'modules.lessons.lessonTitle': 1, 
      'modules.lessons.lessonType': 1, 
      'modules.lessons.meetingUrl': 1, 
      'modules.lessons.videoUrl': 1, 
      'modules.lessons.s3Key': 1, 
      'modules.lessons.videoS3Key': 1, 
      'modules.lessons.videoParts': 1,
      'modules.lessons.pdfNotes': 1,
      'modules.lessons.assignments': 1,
      'modules.lessons.attachments': 1
    } 
  }).toArray();

  for (const c of courses) {
    console.log(`Course [${c._id}]: ${c.title}`);
    if (c.modules) {
      for (const m of c.modules) {
        console.log(`  Module [${m._id}]: ${m.title}`);
        if (m.lessons) {
          for (const l of m.lessons) {
            console.log(`    Lesson [${l._id}]: "${l.lessonTitle}" | Type: ${l.lessonType}`);
            console.log(`      meetingUrl: "${l.meetingUrl || ''}"`);
            console.log(`      videoUrl: "${l.videoUrl || ''}"`);
            console.log(`      s3Key: "${l.s3Key || ''}" | videoS3Key: "${l.videoS3Key || ''}"`);
            console.log(`      videoParts (${(l.videoParts || []).length}):`, JSON.stringify(l.videoParts));
            if (l.pdfNotes && l.pdfNotes.length) console.log(`      pdfNotes (${l.pdfNotes.length}):`, JSON.stringify(l.pdfNotes));
            if (l.assignments && l.assignments.length) console.log(`      assignments (${l.assignments.length}):`, JSON.stringify(l.assignments));
            if (l.attachments && l.attachments.length) console.log(`      attachments (${l.attachments.length}):`, JSON.stringify(l.attachments));
          }
        }
      }
    }
  }

  console.log('\n=== RECORDINGS / LIVELINKS ===');
  const recordings = await db.collection('recordings').find({}).toArray();
  console.log(`Total in recordings: ${recordings.length}`);
  for (const r of recordings) {
    console.log(`Recording [${r._id}]: lessonTitle="${r.lessonTitle}", courseName="${r.courseName}", streamUrl="${r.streamUrl}", recordedVideoUrl="${r.recordedVideoUrl}", recordingFileUrl="${r.recordingFileUrl}", s3Key="${r.s3Key}", courseId="${r.courseId}", moduleId="${r.moduleId}", lessonId="${r.lessonId}"`);
  }

  const liveRecords = await db.collection('liverecords').find({}).toArray();
  console.log(`Total in liverecords: ${liveRecords.length}`);
  for (const r of liveRecords) {
    console.log(`LiveRecord [${r._id}]: lessonTitle="${r.lessonTitle}", courseName="${r.courseName}", streamUrl="${r.streamUrl}", recordedVideoUrl="${r.recordedVideoUrl}", recordingFileUrl="${r.recordingFileUrl}", s3Key="${r.s3Key}", courseId="${r.courseId}", moduleId="${r.moduleId}", lessonId="${r.lessonId}"`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

