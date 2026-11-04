const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testKeyExistsInS3(targetKey) {
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await mongoose.connection.db.collection('users').findOne({ role: 'admin' });
  const token = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: 'admin' },
    process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure',
    { expiresIn: '1d' }
  );

  const tempId = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection('demovideos').insertOne({
    _id: tempId,
    title: '__temp_probe_test__',
    s3Key: targetKey,
    videoUrl: 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/' + targetKey,
    status: 'Published'
  });

  try {
    const res = await fetch(`https://homeopathybackend-1.onrender.com/api/s3-upload/media/access-url?s3Key=${encodeURIComponent(targetKey)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`[${targetKey}] Render response status:`, res.status);
    const data = await res.json();
    console.log(`[${targetKey}] Result:`, data);
  } finally {
    await mongoose.connection.db.collection('demovideos').deleteOne({ _id: tempId });
    await mongoose.disconnect();
  }
}

async function run() {
  const keys = [
    'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4',
    'videos/1793013512772-1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1_faststart.mp4',
    'videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4'
  ];
  for (const k of keys) {
    await testKeyExistsInS3(k);
  }
}

run().catch(console.error);

