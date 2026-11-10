const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { S3Client, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

dotenv.config({ path: 'C:/Users/admin/StudioProjects/HomeopathyBackend/.env' });

const { s3Client, bucket, region } = require('../config/s3');
const Exam = require('../models/Exam');

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB');

    // 1. Search for any exams with imageUrl containing grand_mock_questions
    const exams = await Exam.find({
      'questions.imageUrl': { $regex: 'grand_mock_questions' }
    }).lean();

    console.log(`Found ${exams.length} exams with grand_mock_questions in questions.imageUrl`);

    const imageKeys = new Set();
    const rawImageUrls = new Set();

    for (const exam of exams) {
      console.log(`\nExam: "${exam.title}" (_id: ${exam._id}, testType: ${exam.testType})`);
      for (const [idx, q] of exam.questions.entries()) {
        if (q.imageUrl && q.imageUrl.includes('grand_mock_questions')) {
          console.log(`  Question ${idx + 1} (_id: ${q._id}):`);
          console.log(`    questionText: ${q.questionText}`);
          console.log(`    imageUrl: ${q.imageUrl}`);
          rawImageUrls.add(q.imageUrl);

          // Extract key
          const match = q.imageUrl.match(/grand_mock_questions\/[^\s?"]+/);
          if (match) {
            imageKeys.add(match[0]);
          }
        }
      }
    }

    // Also check if any exams have other image fields
    const allExamsWithAnyImage = await Exam.find({
      $or: [
        { 'questions.imageUrl': { $exists: true, $ne: null, $ne: '' } },
        { 'questions.image': { $exists: true, $ne: null, $ne: '' } },
        { 'questions.questionImage': { $exists: true, $ne: null, $ne: '' } },
      ]
    }).select('title testType questions._id questions.imageUrl questions.image questions.questionImage').lean();

    console.log(`\nTotal exams with ANY image in questions: ${allExamsWithAnyImage.length}`);
    for (const e of allExamsWithAnyImage) {
      console.log(`Exam "${e.title}" (_id: ${e._id}, testType: ${e.testType})`);
      for (const q of e.questions || []) {
        const img = q.imageUrl || q.image || q.questionImage;
        if (img) {
          console.log(`  Q ${q._id}: ${img}`);
          const match = img.match(/(grand_mock_questions\/[^\s?"]+|images\/[^\s?"]+)/);
          if (match) imageKeys.add(match[0]);
        }
      }
    }

    // 2. Check S3 for these keys
    console.log('\n--- Checking S3 Objects ---');
    console.log('Bucket:', bucket);
    console.log('Region:', region);

    for (const key of imageKeys) {
      try {
        const head = await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }));
        console.log(`✅ S3 HeadObject SUCCESS: ${key} (${head.ContentLength} bytes, type: ${head.ContentType})`);
      } catch (err) {
        console.error(`❌ S3 HeadObject FAILED: ${key} -> ${err.name}: ${err.message}`);
      }
    }

    // 3. List objects under grand_mock_questions/ prefix
    console.log('\n--- Listing S3 prefix: grand_mock_questions/ ---');
    try {
      const listRes = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'grand_mock_questions/',
        MaxKeys: 20,
      }));
      for (const obj of listRes.Contents || []) {
        console.log(`S3 Object: ${obj.Key} (${obj.Size} bytes, modified: ${obj.LastModified})`);
      }
    } catch (err) {
      console.error('ListObjects error:', err.message);
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Main error:', err);
  }
}

main();
