require('dotenv').config();
const mongoose = require('mongoose');
const Recording = require('../models/Recording');

async function cleanRecordingDatabase() {
  console.log('🔍 Connecting to MongoDB Atlas cluster...');
  const uri = process.env.MONGODB_URI || 'mongodb+srv://rizlaah01_db_user:j8qWhyvSFCBQbnBg@cluster0.fhwuccm.mongodb.net/homeopathy_db?retryWrites=true&w=majority';
  
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB Atlas cluster successfully!\n');

  const allRecordings = await Recording.find();
  console.log(`Found ${allRecordings.length} total recording document(s) in database.\n`);

  let updatedCount = 0;

  for (const rec of allRecordings) {
    let needsUpdate = false;
    const currentVideoUrl = (rec.recordedVideoUrl || rec.recordingFileUrl || '').trim();

    // Check if URL is restricted Google Cloud Storage or dummy external link
    const isRestrictedUrl =
      currentVideoUrl.includes('storage.googleapis.com') ||
      currentVideoUrl.includes('storage.cloud.google.com') ||
      currentVideoUrl.includes('drive.google.com') ||
      currentVideoUrl.includes('sample-videos.com') ||
      currentVideoUrl.includes('example.com') ||
      currentVideoUrl.includes('dummy');

    if (isRestrictedUrl) {
      console.log(`⚠️ Cleaning recording document ID: ${rec._id}`);
      console.log(`   Lesson: "${rec.lessonTitle || 'Untitled'}"`);
      console.log(`   Removing restricted URL: ${currentVideoUrl}`);

      rec.recordedVideoUrl = '';
      rec.recordingFileUrl = '';
      if (rec.status === 'stopped' || rec.status === 'recorded') {
        rec.status = 'pending';
      }
      needsUpdate = true;
    }

    if (needsUpdate) {
      await rec.save();
      updatedCount++;
    }
  }

  console.log(`\n✅ Database inspection & cleanup complete! Updated ${updatedCount} document(s).`);
  await mongoose.disconnect();
}

cleanRecordingDatabase().catch((err) => {
  console.error('❌ Error during cleanup:', err.message);
  process.exit(1);
});
