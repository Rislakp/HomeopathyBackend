const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Course = require('../models/Course');
const { formatCourseForStudent, addSignedS3MediaUrls } = require('../controllers/studentCurriculumController');

async function simulateStudentLearn() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const courses = await Course.find({}).lean();
  console.log(`Inspecting ${courses.length} courses via formatCourseForStudent + addSignedS3MediaUrls...`);

  for (const c of courses) {
    const formatted = await addSignedS3MediaUrls(formatCourseForStudent(c));
    let pharmacy4Lessons = [];
    let allLessonsInfo = [];

    for (const m of formatted.modules || []) {
      for (const l of m.lessons || []) {
        const title = l.lessonTitle || l.title || l.name;
        const vParts = l.videoParts || [];
        const hasPharmacy4 = JSON.stringify(l).toLowerCase().includes('pharmacy-4');
        allLessonsInfo.push({
          moduleId: m._id || m.id,
          moduleTitle: m.moduleTitle || m.title,
          lessonId: l._id || l.id,
          lessonTitle: title,
          videoUrl: l.videoUrl ? (l.videoUrl.substring(0, 60) + '...') : '',
          s3Key: l.s3Key,
          videoPartsCount: vParts.length,
          videoParts: vParts.map(vp => ({
            title: vp.title,
            s3Key: vp.s3Key,
            fileName: vp.fileName,
            hasUrl: !!vp.url,
          })),
        });
        if (hasPharmacy4) {
          pharmacy4Lessons.push({
            moduleId: m._id || m.id,
            moduleTitle: m.moduleTitle || m.title,
            lessonId: l._id || l.id,
            lessonTitle: title,
            s3Key: l.s3Key,
            vParts: vParts.length,
          });
        }
      }
    }

    if (pharmacy4Lessons.length > 0 || c.courseId === 'CRS-000080') {
      console.log(`\n==================================================`);
      console.log(`COURSE: "${c.courseTitle || c.title}" (ID: ${c._id}, courseId: ${c.courseId})`);
      console.log(`Pharmacy-4 found in ${pharmacy4Lessons.length} lesson(s):`, pharmacy4Lessons);
      console.log('ALL LESSONS in this course:');
      for (const li of allLessonsInfo) {
        console.log(`  [Mod: ${li.moduleTitle}] Lesson: "${li.lessonTitle}" (id: ${li.lessonId})`);
        console.log(`    s3Key: ${li.s3Key} | videoParts: ${li.videoPartsCount}`);
        for (const vp of li.videoParts) {
          console.log(`      vp: "${vp.title}" | s3Key: ${vp.s3Key} | fileName: ${vp.fileName}`);
        }
      }
    }
  }

  await mongoose.disconnect();
}

simulateStudentLearn().catch(console.error);
