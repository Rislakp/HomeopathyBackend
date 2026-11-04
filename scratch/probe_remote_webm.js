const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ffprobePath = 'C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffprobe.exe';

async function probeWebm(key) {
  const token = jwt.sign(
    { id: '6ac33e788008a43235f51f8d', email: 'admin_rbac_1791180408707@test.com', role: 'admin' },
    process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure',
    { expiresIn: '1d' }
  );

  console.log('\n--- Probing:', key);
  const res = await fetch('https://homeopathybackend-1.onrender.com/api/s3-upload/media/access-url?s3Key=' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  if (!data.url) {
    console.log('Failed to get signed URL:', data.message);
    return;
  }
  console.log('Got signed URL, probing...');
  try {
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
    console.log('Streams:', info.streams.map(s => ({
      index: s.index,
      codec_name: s.codec_name,
      codec_type: s.codec_type,
      profile: s.profile,
      width: s.width,
      height: s.height,
      r_frame_rate: s.r_frame_rate,
      pix_fmt: s.pix_fmt,
      sample_rate: s.sample_rate,
      channels: s.channels
    })));
  } catch (err) {
    console.error('ffprobe error:', err.message);
  }
}

async function run() {
  await probeWebm('videos/1792160185067-83d7ed83-05a7-4698-8944-72fdc142cc8c-PHARMACY-PART-3.webm');
  await probeWebm('videos/1792162686897-599e9778-19a9-48a9-9769-915fc78de75c-RESPIRATORY-1.webm');
  await probeWebm('videos/1792163009954-d6a9fb79-f8b2-44ba-8761-04a133914add-RESPIRATORY-1.webm');
}

run();

