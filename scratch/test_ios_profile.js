const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');

async function testProfile() {
  const token = jwt.sign({ id: '6ac33e788008a43235f51f8d', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const key = 'videos/1794383338294-28008739-75a2-4a74-ae7c-0c07c6c9e758-Respiratory-3.mp4';
  const res = await fetch('https://api.whitecoat.academy/api/s3-upload/media/access-url?s3Key=' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  const inputUrl = data.url;

  console.log('Testing iOS conversion profile on a 60s sample of Respiratory-3...');
  const outPath = path.join(__dirname, 'test_ios_sample.m4v');

  // Test the profile: 30 fps CFR, closed GOP 2s (60 frames), AAC 48k, aresample, faststart
  const cmd = `ffmpeg -y -ss 0 -t 60 -i "${inputUrl}" -map 0:v:0 -map 0:a:0? -c:v libx264 -profile:v main -level:v 4.0 -pix_fmt yuv420p -r 30 -fps_mode cfr -g 60 -keyint_min 60 -sc_threshold 0 -flags +cgop -crf 22 -preset fast -c:a aac -b:a 128k -ar 48000 -ac 2 -af aresample=async=1 -movflags +faststart -f mp4 "${outPath}"`;
  
  execSync(cmd, { stdio: 'inherit' });

  console.log('\n--- Probing Transcoded Sample ---');
  const probeOut = execSync(`ffprobe -v error -show_entries stream=codec_name,codec_type,profile,level,r_frame_rate,avg_frame_rate,start_time -show_entries format=duration,size,bit_rate -of json "${outPath}"`).toString();
  console.log('Stream info:', JSON.parse(probeOut));

  const frameOut = execSync(`ffprobe -v error -select_streams v:0 -show_frames -show_entries frame=key_frame,pts_time,pict_type -of json "${outPath}"`).toString();
  const frames = JSON.parse(frameOut).frames;
  const keyframes = frames.filter(f => f.key_frame === 1);
  console.log('Total frames:', frames.length);
  console.log('Total keyframes:', keyframes.length);
  console.log('Keyframe pts_time (first 10):', keyframes.slice(0, 10).map(k => k.pts_time));
  const gops = [];
  for (let i = 1; i < keyframes.length; i++) {
    gops.push((parseFloat(keyframes[i].pts_time) - parseFloat(keyframes[i-1].pts_time)).toFixed(3));
  }
  console.log('GOP intervals (seconds):', gops.slice(0, 10));
}
testProfile().catch(console.error);

