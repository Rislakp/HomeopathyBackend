const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const lessonIds = [
    '6add86082cea39ee852ada81',
    '6add83352cea39ee852ad586',
    '6add85af2cea39ee852ad850',
    '6add88062cea39ee852ae213',
  ];

  const LessonProgress = require('../models/LessonProgress');
  const progs = await LessonProgress.find({ lessonId: { $in: lessonIds } }).lean();
  console.log(`Found ${progs.length} LessonProgress records for pharmacy-5:`);
  for (const p of progs) {
    console.log({
      studentId: p.studentId,
      courseId: p.courseId,
      lessonId: p.lessonId,
      videoWatched: p.videoWatched,
      videoProgress: p.videoProgress,
      videoDuration: p.videoDuration,
      watchedPercent: p.watchedPercent,
    });
  }

  process.exit(0);
}

run();

