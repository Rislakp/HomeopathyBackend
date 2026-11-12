const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');

async function getPlaybackUrl(key) {
  const token = jwt.sign({ id: '6ac33e788008a43235f51f8d', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch('https://api.whitecoat.academy/api/s3-upload/media/access-url?s3Key=' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  return data.url;
}

function probeUrl(url, label) {
  console.log(`\n======================================================`);
  console.log(`PROBING: ${label}`);
  console.log(`======================================================`);

  try {
    // 1. Format & Stream Summary
    const streamOut = execSync(`ffprobe -v error -show_entries stream=codec_name,codec_type,profile,level,r_frame_rate,avg_frame_rate,width,height,nb_frames,start_time -show_entries format=duration,size,bit_rate,format_name -of json "${url}"`, { timeout: 30000 }).toString();
    const streamData = JSON.parse(streamOut);
    console.log('Format:', streamData.format);
    console.log('Streams:');
    for (const s of streamData.streams) {
      console.log(`  Stream #${s.codec_type}: codec=${s.codec_name}, profile=${s.profile}, level=${s.level}, r_fps=${s.r_frame_rate}, avg_fps=${s.avg_frame_rate}, start_time=${s.start_time}, res=${s.width}x${s.height}`);
    }

    // 2. First 60 keyframes / GOP intervals
    console.log('\n--- Analyzing GOP and Keyframes (first 120 seconds) ---');
    const frameOut = execSync(`ffprobe -v error -select_streams v:0 -read_intervals "%+120" -show_frames -show_entries frame=key_frame,pts_time,pict_type -of json "${url}"`, { timeout: 45000 }).toString();
    const frameData = JSON.parse(frameOut);
    const keyframes = frameData.frames.filter(f => f.key_frame === 1);
    console.log(`Total video frames in first 120s: ${frameData.frames.length}`);
    console.log(`Total keyframes (I-frames) in first 120s: ${keyframes.length}`);
    
    if (keyframes.length > 0) {
      const gops = [];
      for (let i = 1; i < keyframes.length; i++) {
        const delta = parseFloat(keyframes[i].pts_time) - parseFloat(keyframes[i-1].pts_time);
        gops.push(delta);
      }
      if (gops.length > 0) {
        const minGop = Math.min(...gops);
        const maxGop = Math.max(...gops);
        const avgGop = gops.reduce((a, b) => a + b, 0) / gops.length;
        console.log(`GOP (seconds between keyframes): min=${minGop.toFixed(3)}s, max=${maxGop.toFixed(3)}s, avg=${avgGop.toFixed(3)}s`);
        console.log('First 10 keyframe pts_time:', keyframes.slice(0, 10).map(k => k.pts_time));
      } else {
        console.log('Only 1 keyframe found in 120s! Keyframe interval > 120s!');
      }
    } else {
      console.log('ZERO keyframes found in first 120s!');
    }

  } catch (err) {
    console.error(`Error probing ${label}:`, err.message);
  }
}

async function main() {
  // Video 1: Old working video (pharmacy-1)
  console.log('Resolving Old Working Video (pharmacy-1)...');
  const oldKey = 'videos/1791091513421-cee79365-6193-48da-8210-975a9e7e6a8a-pharmacy-1_ios.m4v';
  const oldUrl = await getPlaybackUrl(oldKey);
  probeUrl(oldUrl, 'OLD WORKING VIDEO: pharmacy-1_ios.m4v');

  // Video 2: Newly uploaded original video (Respiratory-3)
  console.log('\nResolving New Uploaded Original Video (Respiratory-3.mp4)...');
  const newOrigKey = 'videos/1794383338294-28008739-75a2-4a74-ae7c-0c07c6c9e758-Respiratory-3.mp4';
  const newOrigUrl = await getPlaybackUrl(newOrigKey);
  probeUrl(newOrigUrl, 'NEWLY UPLOADED ORIGINAL: Respiratory-3.mp4');

  // Video 3: Newly converted M4V video (Respiratory-3_ios.m4v)
  console.log('\nResolving New Converted Video (Respiratory-3_ios.m4v)...');
  const newM4vKey = 'videos/1794383338294-28008739-75a2-4a74-ae7c-0c07c6c9e758-Respiratory-3_ios.m4v';
  const newM4vUrl = await getPlaybackUrl(newM4vKey);
  probeUrl(newM4vUrl, 'NEW CONVERTED: Respiratory-3_ios.m4v');
}

main().catch(console.error);

