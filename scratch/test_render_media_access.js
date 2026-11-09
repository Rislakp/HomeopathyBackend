const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testRenderMediaAccess() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await mongoose.connection.db.collection('users').findOne({ role: 'admin' });
  console.log('Admin user:', admin.email, admin._id);

  const token = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: admin.role },
    process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure',
    { expiresIn: '1d' }
  );

  const s3Keys = [
    'videos/1791471476238-24b212e5-PART-1_recording.webm',
    'videos/1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3.webm',
    'videos/1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1.webm',
    'videos/1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1.webm',
    'videos/1793015421722-1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3_faststart.mp4',
    'videos/1793013512772-1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1_faststart.mp4',
    'videos/1793015796346-1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1_faststart.mp4'
  ];

  for (const key of s3Keys) {
    console.log('\n=========================================');
    console.log('Requesting URL for:', key);
    const res = await fetch(`https://homeopathybackend-1.onrender.com/api/s3-upload/media/access-url?s3Key=${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('Render status:', res.status);
    const data = await res.json();
    if (data.url) {
      console.log('Signed URL base:', data.url.split('?')[0]);
      // Test fetching the first 100 bytes from S3 using the signed URL
      const s3Res = await fetch(data.url, {
        headers: { Range: 'bytes=0-100' }
      });
      console.log('S3 Range Status:', s3Res.status, s3Res.statusText);
      console.log('S3 Headers:', {
        'content-type': s3Res.headers.get('content-type'),
        'content-range': s3Res.headers.get('content-range'),
        'accept-ranges': s3Res.headers.get('accept-ranges'),
        'content-length': s3Res.headers.get('content-length'),
      });
    } else {
      console.log('Failed:', data.message);
    }
  }

  process.exit(0);
}

testRenderMediaAccess().catch(err => {
  console.error(err);
  process.exit(1);
});
