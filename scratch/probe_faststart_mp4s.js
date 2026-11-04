const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ffprobePath = 'C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffprobe.exe';

async function probeKey(targetKey) {
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
    const data = await res.json();
    if (!data.url) {
      console.log('Error getting URL:', data);
      return;
    }

    console.log(`\n======================================================`);
    console.log(`Probe: ${targetKey}`);
    const probeOutput = execSync(`"${ffprobePath}" -v error -show_format -show_streams -print_format json "${data.url}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000
    });
    const info = JSON.parse(probeOutput);
    console.log('Format:', {
      format_name: info.format.format_name,
      duration: info.format.duration,
      size: info.format.size,
      bit_rate: info.format.bit_rate
    });
    console.log('Streams:');
    for (const s of info.streams) {
      console.log({
        index: s.index,
        codec_name: s.codec_name,
        codec_type: s.codec_type,
        profile: s.profile,
        width: s.width,
        height: s.height,
        pix_fmt: s.pix_fmt,
        duration: s.duration,
        sample_rate: s.sample_rate,
        channels: s.channels
      });
    }

    // Also test Range requests
    const r1 = await fetch(data.url, { headers: { Range: 'bytes=0-100' } });
    console.log('Range 0-100 Status:', r1.status, 'Content-Range:', r1.headers.get('content-range'), 'Content-Type:', r1.headers.get('content-type'));
    const midStart = Math.floor(Number(info.format.size) / 2);
    const r2 = await fetch(data.url, { headers: { Range: `bytes=${midStart}-${midStart + 100}` } });
    console.log(`Range mid Status:`, r2.status, 'Content-Range:', r2.headers.get('content-range'));
    const endStart = Number(info.format.size) - 101;
    const r3 = await fetch(data.url, { headers: { Range: `bytes=${endStart}-` } });
    console.log(`Range end Status:`, r3.status, 'Content-Range:', r3.headers.get('content-range'));
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
    await probeKey(k);
  }
}

run().catch(console.error);

