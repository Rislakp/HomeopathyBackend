require('dotenv').config();
const mongoose = require('mongoose');
const Course = require('../models/Course');
const DemoVideo = require('../models/DemoVideo');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const { bucket } = require('../config/s3');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  // 1. Process Courses
  const courses = await Course.find({});
  console.log(`Found ${courses.length} courses to check/standardize.`);

  let totalUpdatedLessons = 0;
  let totalUpdatedVideoParts = 0;

  for (const course of courses) {
    let courseModified = false;
    for (const mod of course.modules || []) {
      for (const les of mod.lessons || []) {
        // Specific fix for CRS-000070 Module 1 Lesson PART 4 (replace non-faststart with faststart MP4)
        if (les.s3Key === 'videos/1792655168739-8bc5294f-15a1-49d8-8ad8-d3d75094365c-PHARMACY-4.mp4' ||
            les.videoS3Key === 'videos/1792655168739-8bc5294f-15a1-49d8-8ad8-d3d75094365c-PHARMACY-4.mp4') {
          console.log(`[Course ${course.courseId}] Updating PART 4 to verified FastStart MP4: 1792655031349...`);
          les.s3Key = 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4';
          les.videoS3Key = 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4';
          les.videoUrl = '';
          courseModified = true;
          totalUpdatedLessons++;
        }

        // Clean stale S3 URLs in meetingUrl
        if (les.meetingUrl && !/meet\.google\.com|tel\.meet|zoom\.us|teams/i.test(les.meetingUrl) &&
            (les.meetingUrl.includes('.amazonaws.com') || les.meetingUrl.includes('X-Amz-Signature') || /\.mp4|\.webm/i.test(les.meetingUrl))) {
          console.log(`[Course ${course.courseId}] Clearing stale meetingUrl in lesson: ${les.title}`);
          les.meetingUrl = null;
          courseModified = true;
        }

        // Check if lesson's primary s3Key is an MP4/M4V
        const primaryKey = les.s3Key || les.videoS3Key || '';
        if (primaryKey.toLowerCase().endsWith('.mp4') || primaryKey.toLowerCase().endsWith('.m4v')) {
          if (les.videoUrl && les.videoUrl.includes('.webm')) {
            les.videoUrl = '';
            courseModified = true;
          }
        }

        // Check videoParts
        for (const vp of les.videoParts || []) {
          // If PART 4
          if (vp.s3Key === 'videos/1792655168739-8bc5294f-15a1-49d8-8ad8-d3d75094365c-PHARMACY-4.mp4') {
            vp.s3Key = 'videos/1792655031349-816ceb78-a84d-4f79-86ba-a45f07bdb846-PHARMACY-4.mp4';
            vp.fileName = 'PHARMACY-4.mp4';
            vp.originalFileName = 'PHARMACY-4.mp4';
            vp.contentType = 'video/mp4';
            vp.mimetype = 'video/mp4';
            vp.fileSize = 487944644;
            vp.size = 487944644;
            vp.bytes = 487944644;
            vp.url = '';
            courseModified = true;
            totalUpdatedVideoParts++;
          }

          // If s3Key is MP4/M4V
          const vpKey = (vp.s3Key || '').toLowerCase();
          if (vpKey.endsWith('.mp4') || vpKey.endsWith('.m4v')) {
            // Strip .webm title suffix
            if (vp.title && vp.title.toLowerCase().endsWith('.webm')) {
              console.log(`[Course ${course.courseId}] Cleaning title "${vp.title}" -> "${vp.title.replace(/\.webm$/i, '')}"`);
              vp.title = vp.title.replace(/\.webm$/i, '');
              courseModified = true;
              totalUpdatedVideoParts++;
            }
            if (vp.mimetype === 'video/webm' || !vp.mimetype) {
              vp.mimetype = 'video/mp4';
              courseModified = true;
            }
            if (vp.contentType === 'video/webm' || !vp.contentType || vp.contentType === 'application/octet-stream') {
              vp.contentType = 'video/mp4';
              courseModified = true;
            }
            if (vp.fileName && vp.fileName.toLowerCase().endsWith('.webm')) {
              vp.fileName = vp.fileName.replace(/\.webm$/i, '.mp4');
              courseModified = true;
            }
            if (vp.url && vp.url.includes('.webm')) {
              vp.url = '';
              courseModified = true;
            }
          }
        }
      }
    }

    if (courseModified) {
      await course.save();
      console.log(`[DB] Saved changes to course ${course.courseId} (${course.title})`);
    }
  }

  // 2. DemoVideos
  const demoVideos = await DemoVideo.find({});
  for (const dv of demoVideos) {
    if (dv.s3Key && (dv.s3Key.toLowerCase().endsWith('.mp4') || dv.s3Key.toLowerCase().endsWith('.m4v'))) {
      if (dv.videoUrl && dv.videoUrl.includes('.webm')) {
        dv.videoUrl = `https://${bucket}.s3.us-east-1.amazonaws.com/${dv.s3Key}`;
        await dv.save();
        console.log(`[DB] Updated DemoVideo ${dv.title}`);
      }
    }
  }

  // 3. Recordings
  const brokenRec = await Recording.findOne({ s3Key: 'videos/1791471476238-24b212e5-PART-1_recording.webm' });
  if (brokenRec) {
    brokenRec.s3Key = 'videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4';
    brokenRec.recordedVideoUrl = `https://${bucket}.s3.us-east-1.amazonaws.com/videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4`;
    brokenRec.format = 'mp4';
    brokenRec.bytes = 168791549;
    await brokenRec.save();
    console.log(`[DB] Updated broken recording ${brokenRec._id}`);
  }

  console.log(`Finished database standardization. Updated ${totalUpdatedLessons} lessons and ${totalUpdatedVideoParts} videoParts.`);
  await mongoose.disconnect();
}

main().catch(console.error);

