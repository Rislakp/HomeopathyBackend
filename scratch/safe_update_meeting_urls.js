const mongoose = require('mongoose');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: 'c:/Users/admin/StudioProjects/HomeopathyBackend/.env' });
const Course = mongoose.models.Course || mongoose.model('Course', new mongoose.Schema({}, { strict: false }));

const targetIds = [
  { id: '6ad4c0601d1d06b448ce3785', title: 'BTP-2' },
  { id: '6adf190d2cea39ee852c3d07', title: 'part-6' },
  { id: '6adf08c82cea39ee852c25b0', title: 'part-6' },
  { id: '6adf1afb2cea39ee852c3ed9', title: 'part-6' },
  { id: '6ae316590cb975b06f54689e', title: 'Part-6' }
];

const BACKUP_PATH_1 = 'C:/Users/admin/.gemini/antigravity/brain/889adac9-8ce1-4900-879e-3c2546594c43/scratch/production_lessons_backup_20261119.json';
const BACKUP_PATH_2 = 'c:/Users/admin/StudioProjects/HomeopathyBackend/scratch/production_lessons_backup_20261119.json';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy');

  console.log('========================================================================');
  console.log('STEP 1: FETCHING AND BACKING UP 5 PRODUCTION LESSONS');
  console.log('========================================================================');

  const backupData = [];

  for (const t of targetIds) {
    const course = await Course.findOne({ 'modules.lessons._id': new mongoose.Types.ObjectId(t.id) }).lean();
    assert(course, 'Course not found for lesson ' + t.id);

    let lesson = null;
    let moduleItem = null;
    for (const m of course.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === t.id) {
          lesson = l;
          moduleItem = m;
          break;
        }
      }
    }
    assert(lesson, 'Lesson not found ' + t.id);

    // Validation checks before backup
    const meetingUrl = (lesson.meetingUrl || '').trim();
    assert(meetingUrl.toLowerCase().includes('.pdf'), 'Target meetingUrl must be a PDF URL: ' + meetingUrl);
    assert(lesson.pdfNotes && lesson.pdfNotes.length > 0, 'Target lesson must have PDF in pdfNotes');

    backupData.push({
      courseId: course._id.toString(),
      moduleId: moduleItem._id.toString(),
      lessonId: t.id,
      lessonTitle: t.title,
      lessonRecord: lesson
    });

    console.log(`Backed up lesson: ${t.id} (${t.title})`);
  }

  fs.writeFileSync(BACKUP_PATH_1, JSON.stringify(backupData, null, 2), 'utf-8');
  fs.writeFileSync(BACKUP_PATH_2, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log('Saved backup to:');
  console.log('  1. ' + BACKUP_PATH_1);
  console.log('  2. ' + BACKUP_PATH_2);

  console.log('\n========================================================================');
  console.log('STEP 2: PERFORMING TARGETED SAFE UPDATE (ONLY meetingUrl = "")');
  console.log('========================================================================');

  const updateResults = [];

  for (const b of backupData) {
    const lessonIdObj = new mongoose.Types.ObjectId(b.lessonId);
    const courseIdObj = new mongoose.Types.ObjectId(b.courseId);

    // Perform targeted positional update
    const updateRes = await Course.updateOne(
      { _id: courseIdObj, 'modules.lessons._id': lessonIdObj },
      { $set: { 'modules.$[m].lessons.$[l].meetingUrl': '' } },
      {
        arrayFilters: [
          { 'm.lessons._id': lessonIdObj },
          { 'l._id': lessonIdObj }
        ]
      }
    );

    assert(updateRes.matchedCount === 1, 'Matched count must be 1 for lesson ' + b.lessonId);
    assert(updateRes.modifiedCount === 1, 'Modified count must be 1 for lesson ' + b.lessonId);

    // Step 3: Re-fetch updated course and lesson to verify
    const updatedCourse = await Course.findById(courseIdObj).lean();
    let updatedLesson = null;
    for (const m of updatedCourse.modules || []) {
      for (const l of m.lessons || []) {
        if (l._id.toString() === b.lessonId) {
          updatedLesson = l;
          break;
        }
      }
    }
    assert(updatedLesson, 'Updated lesson not found ' + b.lessonId);

    // Verify meetingUrl is empty
    assert.strictEqual(updatedLesson.meetingUrl, '', 'meetingUrl must be empty string after update');

    // Verify all other fields are identical to backup
    const original = b.lessonRecord;
    for (const key of Object.keys(original)) {
      if (key === 'meetingUrl') continue;
      // Compare JSON stringification for deep object equality
      const origVal = JSON.stringify(original[key]);
      const newVal = JSON.stringify(updatedLesson[key]);
      assert.strictEqual(origVal, newVal, `Field "${key}" must be identical for lesson ${b.lessonId}`);
    }

    // Verify no new unexpected fields
    for (const key of Object.keys(updatedLesson)) {
      if (key === 'meetingUrl') continue;
      assert(key in original, `Unexpected field "${key}" appeared in lesson ${b.lessonId}`);
    }

    updateResults.push({
      lessonId: b.lessonId,
      lessonTitle: b.lessonTitle,
      beforeMeetingUrl: original.meetingUrl,
      afterMeetingUrl: updatedLesson.meetingUrl,
      pdfNotesPreserved: updatedLesson.pdfNotes && updatedLesson.pdfNotes.length > 0,
      videoPartsPreserved: updatedLesson.videoParts && updatedLesson.videoParts.length > 0,
      pdfNotesCount: updatedLesson.pdfNotes ? updatedLesson.pdfNotes.length : 0,
      videoPartsCount: updatedLesson.videoParts ? updatedLesson.videoParts.length : 0,
      pdfTitle: updatedLesson.pdfNotes && updatedLesson.pdfNotes[0] ? updatedLesson.pdfNotes[0].title : '',
      pdfS3Key: updatedLesson.pdfNotes && updatedLesson.pdfNotes[0] ? updatedLesson.pdfNotes[0].s3Key : '',
      videoTitle: updatedLesson.videoParts && updatedLesson.videoParts[0] ? updatedLesson.videoParts[0].title : '',
      videoS3Key: updatedLesson.videoParts && updatedLesson.videoParts[0] ? updatedLesson.videoParts[0].s3Key : ''
    });

    console.log(`[SUCCESS] Verified lesson ${b.lessonId} (${b.lessonTitle}): meetingUrl cleared, all fields identical.`);
  }

  console.log('\n========================================================================');
  console.log('STEP 3: SUMMARY REPORT');
  console.log('========================================================================');
  console.log(JSON.stringify(updateResults, null, 2));

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\nEXECUTION FAILED:', err);
  process.exit(1);
});

