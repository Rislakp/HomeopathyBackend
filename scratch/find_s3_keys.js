/**
 * Find valid S3 keys in the database for testing presigned URLs.
 * Run: node scratch/find_s3_keys.js
 */
const dotenv = require('dotenv');
const mongoose = require('mongoose');
dotenv.config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Use raw collections to find S3 keys
  const db = mongoose.connection.db;
  
  // 1. Check courses for video/pdf s3 keys
  console.log('=== Searching for S3 keys in courses ===');
  const courses = await db.collection('courses').find({}).limit(5).toArray();
  for (const c of courses) {
    console.log(`\nCourse: ${c.courseName || c.title} (${c._id})`);
    if (c.modules) {
      for (const mod of c.modules.slice(0, 2)) {
        if (mod.lessons) {
          for (const lesson of mod.lessons.slice(0, 3)) {
            const keys = [];
            if (lesson.videoS3Key) keys.push({ type: 'video', key: lesson.videoS3Key });
            if (lesson.s3Key) keys.push({ type: 's3Key', key: lesson.s3Key });
            if (lesson.pdfNotes) {
              for (const pdf of (Array.isArray(lesson.pdfNotes) ? lesson.pdfNotes : [lesson.pdfNotes])) {
                if (pdf?.s3Key) keys.push({ type: 'pdf', key: pdf.s3Key });
              }
            }
            if (lesson.videoParts) {
              for (const vp of (Array.isArray(lesson.videoParts) ? lesson.videoParts : [lesson.videoParts])) {
                if (vp?.s3Key) keys.push({ type: 'videoPart', key: vp.s3Key });
              }
            }
            if (keys.length > 0) {
              console.log(`  Lesson "${lesson.title || lesson.name}": ${JSON.stringify(keys)}`);
            }
          }
        }
      }
    }
  }

  // 2. Check recordings
  console.log('\n=== Searching for S3 keys in recordings ===');
  const recordings = await db.collection('recordings').find({}).limit(5).toArray();
  for (const r of recordings) {
    const keys = [];
    if (r.s3Key) keys.push({ type: 's3Key', key: r.s3Key });
    if (r.recordedVideo?.s3Key) keys.push({ type: 'video', key: r.recordedVideo.s3Key });
    if (keys.length > 0) {
      console.log(`Recording ${r._id}: ${JSON.stringify(keys)}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
