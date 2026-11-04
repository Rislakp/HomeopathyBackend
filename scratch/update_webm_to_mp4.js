const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const coursesCol = mongoose.connection.db.collection('courses');
  const recordingsCol = mongoose.connection.db.collection('recordings');

  // Backup current state to scratch file
  const aiapget = await coursesCol.findOne({ courseId: 'CRS-000040' });
  const combo = await coursesCol.findOne({ courseId: 'CRS-000070' });
  const rec = await recordingsCol.findOne({ _id: new mongoose.Types.ObjectId('6ac640d8ed6d8ba441a19f06') });

  const backup = {
    timestamp: new Date().toISOString(),
    aiapget,
    combo,
    rec
  };
  fs.writeFileSync(path.join(__dirname, 'db_backup_before_mp4_update.json'), JSON.stringify(backup, null, 2));
  console.log('Backup written to scratch/db_backup_before_mp4_update.json');

  // Update 1: AIAPGET (CRS-000040) -> Module 6ac63f56ed6d8ba441a19c7c -> Lesson PART 1 (6ac63f98ed6d8ba441a19cb7)
  const mp4Key1 = 'videos/1793013512772-1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1_faststart.mp4';
  const u1 = await coursesCol.updateOne(
    { courseId: 'CRS-000040', 'modules.lessons._id': new mongoose.Types.ObjectId('6ac63f98ed6d8ba441a19cb7') },
    {
      $set: {
        'modules.$[m].lessons.$[l].s3Key': mp4Key1,
        'modules.$[m].lessons.$[l].videoS3Key': mp4Key1,
        'modules.$[m].lessons.$[l].videoFormat': 'mp4',
        'modules.$[m].lessons.$[l].videoUrl': '',
        'modules.$[m].lessons.$[l].videoParts.0.s3Key': mp4Key1,
        'modules.$[m].lessons.$[l].videoParts.0.format': 'mp4',
        'modules.$[m].lessons.$[l].videoParts.0.contentType': 'video/mp4',
        'modules.$[m].lessons.$[l].videoParts.0.fileName': 'RESPIRATORY-1_faststart.mp4',
        'modules.$[m].lessons.$[l].videoParts.0.size': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.bytes': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.fileSize': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.duration': 3616.2,
        'modules.$[m].lessons.$[l].videoDuration': 3616.2,
      }
    },
    {
      arrayFilters: [
        { 'm.lessons._id': new mongoose.Types.ObjectId('6ac63f98ed6d8ba441a19cb7') },
        { 'l._id': new mongoose.Types.ObjectId('6ac63f98ed6d8ba441a19cb7') }
      ]
    }
  );
  console.log('Update 1 (AIAPGET Lesson PART 1): matched', u1.matchedCount, 'modified', u1.modifiedCount);

  // Update 2: COMBO COURSE (CRS-000070) -> Module 6ac640b6ed6d8ba441a19ebb -> Lesson PART 1 (6ad23ee41d1d06b448cce00b)
  const mp4Key2 = 'videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4';
  const u2 = await coursesCol.updateOne(
    { courseId: 'CRS-000070', 'modules.lessons._id': new mongoose.Types.ObjectId('6ad23ee41d1d06b448cce00b') },
    {
      $set: {
        'modules.$[m].lessons.$[l].s3Key': mp4Key2,
        'modules.$[m].lessons.$[l].videoS3Key': mp4Key2,
        'modules.$[m].lessons.$[l].videoFormat': 'mp4',
        'modules.$[m].lessons.$[l].videoUrl': '',
        'modules.$[m].lessons.$[l].videoParts.0.s3Key': mp4Key2,
        'modules.$[m].lessons.$[l].videoParts.0.format': 'mp4',
        'modules.$[m].lessons.$[l].videoParts.0.contentType': 'video/mp4',
        'modules.$[m].lessons.$[l].videoParts.0.fileName': 'RESPIRATORY-1_faststart.mp4',
        'modules.$[m].lessons.$[l].videoParts.0.size': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.bytes': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.fileSize': 168791549,
        'modules.$[m].lessons.$[l].videoParts.0.duration': 3616.2,
        'modules.$[m].lessons.$[l].videoDuration': 3616.2,
      }
    },
    {
      arrayFilters: [
        { 'm.lessons._id': new mongoose.Types.ObjectId('6ad23ee41d1d06b448cce00b') },
        { 'l._id': new mongoose.Types.ObjectId('6ad23ee41d1d06b448cce00b') }
      ]
    }
  );
  console.log('Update 2 (COMBO Lesson RESPIRATORY 1): matched', u2.matchedCount, 'modified', u2.modifiedCount);

  // Update 3: COMBO COURSE (CRS-000070) -> Module 6ac0efcdbce3dc3b2f5fa3e8 -> Lesson PART 3 (6ad232471d1d06b448cc7486)
  const mp4Key3 = 'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4';
  const u3 = await coursesCol.updateOne(
    { courseId: 'CRS-000070', 'modules.lessons._id': new mongoose.Types.ObjectId('6ad232471d1d06b448cc7486') },
    {
      $set: {
        'modules.$[m].lessons.$[l].s3Key': mp4Key3,
        'modules.$[m].lessons.$[l].videoS3Key': mp4Key3,
        'modules.$[m].lessons.$[l].videoFormat': 'mp4',
        'modules.$[m].lessons.$[l].videoUrl': '',
        'modules.$[m].lessons.$[l].videoParts.0.s3Key': mp4Key3,
        'modules.$[m].lessons.$[l].videoParts.0.format': 'mp4',
        'modules.$[m].lessons.$[l].videoParts.0.contentType': 'video/mp4',
        'modules.$[m].lessons.$[l].videoParts.0.fileName': 'PHARMACY-PART-3_faststart.mp4',
        'modules.$[m].lessons.$[l].videoParts.0.size': 315220752,
        'modules.$[m].lessons.$[l].videoParts.0.bytes': 315220752,
        'modules.$[m].lessons.$[l].videoParts.0.fileSize': 315220752,
        'modules.$[m].lessons.$[l].videoParts.0.duration': 5830.47,
        'modules.$[m].lessons.$[l].videoDuration': 5830.47,
      }
    },
    {
      arrayFilters: [
        { 'm.lessons._id': new mongoose.Types.ObjectId('6ad232471d1d06b448cc7486') },
        { 'l._id': new mongoose.Types.ObjectId('6ad232471d1d06b448cc7486') }
      ]
    }
  );
  console.log('Update 3 (COMBO Lesson PHARMACY PART 3): matched', u3.matchedCount, 'modified', u3.modifiedCount);

  // Update 4: Recording 6ac640d8ed6d8ba441a19f06
  const u4 = await recordingsCol.updateOne(
    { _id: new mongoose.Types.ObjectId('6ac640d8ed6d8ba441a19f06') },
    {
      $set: {
        s3Key: mp4Key2,
        recordedVideoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/' + mp4Key2,
        recordingFileUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/' + mp4Key2,
        format: 'mp4',
        duration: '3616',
        bytes: 168791549
      }
    }
  );
  console.log('Update 4 (Recording PART 1): matched', u4.matchedCount, 'modified', u4.modifiedCount);

  await mongoose.disconnect();
  console.log('Database update completed successfully.');
}

run().catch(err => {
  console.error('Update error:', err);
  process.exit(1);
});

