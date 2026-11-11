const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function inspectTestCourse() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const course = await db.collection('courses').findOne({
    $or: [
      { courseId: 'CRS-000080' },
      { _id: new mongoose.Types.ObjectId('6adb49efd14df4cd5f913477') }
    ]
  });

  console.log('=== COMPLETE COURSE: CRS-000080 ===');
  console.log('ID:', course._id);
  console.log('Title:', course.courseTitle || course.title);
  console.log('Modules count:', course.modules?.length);

  for (let mIdx = 0; mIdx < (course.modules || []).length; mIdx++) {
    const m = course.modules[mIdx];
    console.log(`\n--- MODULE ${mIdx + 1}: ID=${m._id || m.id} Title="${m.moduleTitle || m.title || m.name}" ---`);
    console.log('Lessons count:', m.lessons?.length);
    for (let lIdx = 0; lIdx < (m.lessons || []).length; lIdx++) {
      const l = m.lessons[lIdx];
      console.log(`\n  LESSON ${lIdx + 1}: ID=${l._id || l.id}`);
      console.log(`  Title: "${l.lessonTitle || l.title || l.name}"`);
      console.log(`  Type: "${l.lessonType || l.type}"`);
      console.log(`  s3Key: "${l.s3Key}"`);
      console.log(`  videoS3Key: "${l.videoS3Key}"`);
      console.log(`  videoUrl: "${l.videoUrl}"`);
      console.log(`  storageProvider: "${l.storageProvider}"`);
      console.log(`  videoParts count: ${l.videoParts?.length}`);
      if (l.videoParts?.length) {
        console.log(`  videoParts:`, JSON.stringify(l.videoParts, null, 2));
      }
      console.log(`  pdfNotes count: ${l.pdfNotes?.length}`);
      console.log(`  attachments count: ${l.attachments?.length}`);
      console.log(`  contentItems count: ${l.contentItems?.length}`);
    }
  }

  await mongoose.disconnect();
}

inspectTestCourse().catch(console.error);
