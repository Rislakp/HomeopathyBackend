const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const { s3Client, bucket } = require('../config/s3');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');

async function checkAllVideos() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('=== Checking All Video References ===');

  const courses = await Course.find({}).lean();
  for (const c of courses) {
    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const vids = [...(l.videoParts || [])];
        if (l.videoUrl || l.s3Key || l.videoS3Key) {
          vids.push({ s3Key: l.videoS3Key || l.s3Key, url: l.videoUrl, title: l.lessonTitle });
        }
        for (const v of vids) {
          const key = v.s3Key || v.url || '';
          if (typeof key === 'string' && (key.includes('videos/') || key.endsWith('.mp4') || key.endsWith('.webm'))) {
            const cleanKey = key.startsWith('http') ? key.split('.amazonaws.com/')[1]?.split('?')[0] : key;
            if (cleanKey) {
              const isWebm = cleanKey.endsWith('.webm');
              let exists = false;
              let s3Type = '';
              let s3Size = 0;
              try {
                const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: cleanKey }));
                exists = true;
                s3Type = head.ContentType;
                s3Size = head.ContentLength;
              } catch (e) {
                exists = false;
              }

              console.log(`Course [${c.courseId}] Lesson "${l.lessonTitle}":`);
              console.log(`  Key: ${cleanKey}`);
              console.log(`  isWebm: ${isWebm}, mp4S3Key: "${v.mp4S3Key || l.mp4S3Key || ''}", S3 exists: ${exists}, size: ${(s3Size/(1024*1024)).toFixed(2)}MB, s3Type: ${s3Type}`);
            }
          }
        }
      }
    }
  }

  // Also check recordings
  console.log('\n=== Checking Recordings Collection ===');
  const recordings = await Recording.find({}).lean();
  for (const r of recordings) {
    if (r.s3Key) {
      let exists = false;
      let s3Type = '';
      let s3Size = 0;
      try {
        const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: r.s3Key }));
        exists = true;
        s3Type = head.ContentType;
        s3Size = head.ContentLength;
      } catch (e) { exists = false; }
      console.log(`Recording "${r.lessonTitle}" (${r.courseName}):`);
      console.log(`  s3Key: ${r.s3Key}, exists: ${exists}, size: ${(s3Size/(1024*1024)).toFixed(2)}MB, s3Type: ${s3Type}`);
    }
  }

  await mongoose.disconnect();
}

checkAllVideos();
