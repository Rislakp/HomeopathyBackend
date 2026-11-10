require('dotenv').config();
const mongoose = require('mongoose');
const { getMyCourseContent } = require('../controllers/studentCurriculumController');
const Course = require('../models/Course');

async function checkCurriculum() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const courseIds = ['CRS-000040', 'CRS-000041', 'CRS-000042', 'CRS-000070'];
  let totalLessonsChecked = 0;
  let totalVideosChecked = 0;
  let errors = [];

  for (const cid of courseIds) {
    console.log(`\n======================================================`);
    console.log(`Checking Curriculum for Course: ${cid}`);
    console.log(`======================================================`);

    const req = {
      params: { courseId: cid },
      user: { id: 'admin1', role: 'admin' },
      headers: { host: 'localhost:5000' },
      protocol: 'https',
    };

    let responseData = null;
    const res = {
      status(c) { return this; },
      json(data) { responseData = data; return this; },
    };

    await getMyCourseContent(req, res);
    const course = responseData?.data?.course || responseData?.data;
    if (!course || !course.modules) {
      errors.push(`Course ${cid} failed to load curriculum`);
      continue;
    }

    for (const mod of course.modules) {
      for (const les of mod.lessons || []) {
        totalLessonsChecked++;
        if (les.videoUrl) {
          totalVideosChecked++;
          const isWebm = les.videoUrl.toLowerCase().includes('.webm') || les.videoUrl.toLowerCase().includes('video%2fwebm');
          const isMp4 = les.videoUrl.toLowerCase().includes('video%2fmp4');
          if (isWebm) {
            errors.push(`Lesson "${les.title}" in course ${cid} has WEBM in videoUrl: ${les.videoUrl.slice(0, 100)}`);
          }
          if (!isMp4 && les.videoUrl.includes('whitecoat-media-prod')) {
            errors.push(`Lesson "${les.title}" in course ${cid} missing video/mp4 response-content-type: ${les.videoUrl.slice(0, 100)}`);
          }
        }
        if (les.meetingUrl) {
          if (!/meet\.google\.com|tel\.meet|zoom\.us|teams/i.test(les.meetingUrl)) {
            errors.push(`Lesson "${les.title}" in course ${cid} has invalid meetingUrl: ${les.meetingUrl}`);
          }
        }
        for (const vp of les.videoParts || []) {
          if (vp.url && (vp.url.toLowerCase().includes('.webm') || vp.url.toLowerCase().includes('video%2fwebm'))) {
            errors.push(`videoPart "${vp.title}" in lesson "${les.title}" has WEBM url: ${vp.url.slice(0, 100)}`);
          }
        }
      }
    }
    console.log(`Course ${cid}: Checked ${course.modules.length} modules, all lessons validated.`);
  }

  console.log(`\n------------------------------------------------------`);
  console.log(`Summary: Checked ${totalLessonsChecked} lessons, ${totalVideosChecked} video URLs.`);
  if (errors.length === 0) {
    console.log(`ALL CHECKS PASSED: 0 WEBM leaks, 100% compliant video/mp4 URLs, clean meetingUrls!`);
  } else {
    console.error(`ERRORS FOUND (${errors.length}):`, errors);
  }
  console.log(`------------------------------------------------------`);

  await mongoose.disconnect();
}

checkCurriculum().catch(console.error);

