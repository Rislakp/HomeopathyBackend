const mongoose = require('mongoose');
require('dotenv').config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

async function inspect() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB:', mongoose.connection.name);

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));

    // 1. Check recordings collections
    for (const colName of ['recordings', 'liverecords', 'live_records']) {
      if (collections.some(c => c.name === colName)) {
        console.log(`\n--- Inspecting collection: ${colName} ---`);
        const total = await db.collection(colName).countDocuments();
        console.log(`Total documents in ${colName}: ${total}`);
        
        // Search for 1791471476238 or PART-1
        const matchingPart1 = await db.collection(colName).find({
          $or: [
            { recordedVideoUrl: { $regex: '1791471476238' } },
            { recordingFileUrl: { $regex: '1791471476238' } },
            { s3Key: { $regex: '1791471476238' } },
            { lessonTitle: { $regex: 'PART 1', $options: 'i' } },
            { lessonTitle: { $regex: 'PART-1', $options: 'i' } },
            { recordedVideoUrl: { $regex: 'PART', $options: 'i' } },
            { s3Key: { $regex: 'PART', $options: 'i' } }
          ]
        }).toArray();
        console.log(`Found matching PART-1 / 1791471476238 in ${colName}:`, matchingPart1.length);
        if (matchingPart1.length > 0) {
          console.log(JSON.stringify(matchingPart1, null, 2));
        }

        // Search for screen-capture
        const matchingScreenCapture = await db.collection(colName).find({
          $or: [
            { recordedVideoUrl: { $regex: 'screen-capture', $options: 'i' } },
            { recordingFileUrl: { $regex: 'screen-capture', $options: 'i' } },
            { s3Key: { $regex: 'screen-capture', $options: 'i' } },
            { lessonTitle: { $regex: 'screen-capture', $options: 'i' } }
          ]
        }).toArray();
        console.log(`Found matching screen-capture in ${colName}:`, matchingScreenCapture.length);
        if (matchingScreenCapture.length > 0) {
          console.log(JSON.stringify(matchingScreenCapture, null, 2));
        }

        // Show last 3 recordings
        const latest = await db.collection(colName).find({}).sort({ createdAt: -1 }).limit(3).toArray();
        console.log(`Latest 3 in ${colName}:`, JSON.stringify(latest, null, 2));
      }
    }

    // 2. Check courses and lessons for PART 1_Notes and Pharmacy OCT 6 and screen-capture
    if (collections.some(c => c.name === 'courses')) {
      console.log('\n--- Inspecting courses for PDFs and screen-capture ---');
      const coursesWithPdfs = await db.collection('courses').find({
        $or: [
          { 'modules.lessons.pdfNotes.title': { $regex: 'PART 1', $options: 'i' } },
          { 'modules.lessons.pdfNotes.title': { $regex: 'Pharmacy OCT', $options: 'i' } },
          { 'modules.lessons.pdfNotes.url': { $regex: 'PART', $options: 'i' } },
          { 'modules.lessons.pdfNotes.url': { $regex: 'Pharmacy', $options: 'i' } },
          { 'modules.lessons.videoParts.url': { $regex: 'screen-capture', $options: 'i' } },
          { 'modules.lessons.videoParts.title': { $regex: 'screen-capture', $options: 'i' } }
        ]
      }).toArray();
      console.log(`Found matching courses: ${coursesWithPdfs.length}`);
      for (const c of coursesWithPdfs) {
        console.log(`Course: ${c.courseTitle || c.title} (_id: ${c._id})`);
        for (const m of c.modules || []) {
          for (const l of m.lessons || []) {
            const pdfs = (l.pdfNotes || []).filter(p => /PART|Pharmacy/i.test(p.title || p.url || ''));
            const vids = (l.videoParts || []).filter(v => /screen-capture/i.test(v.title || v.url || ''));
            if (pdfs.length > 0 || vids.length > 0 || /PART|Pharmacy|screen-capture/i.test(l.lessonTitle || '')) {
              console.log(`  Lesson: ${l.lessonTitle}`);
              console.log(`    videoUrl: ${l.videoUrl}`);
              console.log(`    pdfUrl: ${l.pdfUrl}`);
              console.log(`    pdfNotes:`, JSON.stringify(l.pdfNotes, null, 2));
              console.log(`    videoParts:`, JSON.stringify(l.videoParts, null, 2));
            }
          }
        }
      }
    }

    // Also check standalone lessons collection if present
    if (collections.some(c => c.name === 'lessons')) {
      console.log('\n--- Inspecting lessons collection ---');
      const lessons = await db.collection('lessons').find({
        $or: [
          { lessonTitle: { $regex: 'PART|Pharmacy|screen-capture', $options: 'i' } },
          { uploadFileOrLink: { $regex: 'PART|Pharmacy|screen-capture', $options: 'i' } }
        ]
      }).toArray();
      console.log(`Found matching lessons: ${lessons.length}`);
      if (lessons.length > 0) {
        console.log(JSON.stringify(lessons, null, 2));
      }
    }

    // 3. Check exams collection for questions with images
    if (collections.some(c => c.name === 'exams')) {
      console.log('\n--- Inspecting exams for question images ---');
      const totalExams = await db.collection('exams').countDocuments();
      console.log(`Total exams: ${totalExams}`);

      const examsWithImages = await db.collection('exams').find({
        $or: [
          { 'questions.imageUrl': { $exists: true, $ne: null, $ne: '' } },
          { 'questions.image': { $exists: true, $ne: null, $ne: '' } },
          { 'questions.questionImage': { $exists: true, $ne: null, $ne: '' } }
        ]
      }).limit(5).toArray();

      console.log(`Exams with image questions found: ${examsWithImages.length}`);
      for (const ex of examsWithImages) {
        console.log(`Exam: ${ex.examTitle || ex.title} (_id: ${ex._id})`);
        const imgQuestions = (ex.questions || []).filter(q => q.imageUrl || q.image || q.questionImage);
        console.log(`  Image questions count: ${imgQuestions.length}`);
        for (const q of imgQuestions.slice(0, 5)) {
          console.log(`    Q: "${q.questionText?.slice(0, 50)}..."`);
          console.log(`       imageUrl: ${q.imageUrl}`);
          console.log(`       image: ${q.image}`);
          console.log(`       questionImage: ${q.questionImage}`);
        }
      }
    }

    await mongoose.disconnect();
    console.log('\nDone inspection.');
  } catch (err) {
    console.error('Inspection error:', err);
    process.exit(1);
  }
}

inspect();
