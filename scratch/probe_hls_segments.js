const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { execSync } = require('child_process');

const scratchDir = path.join(__dirname, 'hls_segments');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir);

async function downloadSegment(key, localPath) {
  if (fs.existsSync(localPath)) return;
  console.log(`Downloading ${key} -> ${localPath}...`);
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(chunk);
  }
  fs.writeFileSync(localPath, Buffer.concat(chunks));
}

function probeSegment(localPath, label) {
  console.log(`\n======================================================`);
  console.log(`PROBING: ${label} (${path.basename(localPath)}, size: ${fs.statSync(localPath).size} bytes)`);
  console.log(`======================================================`);

  // 1. Stream information (codecs, pixel format, profile)
  const streamsJson = execSync(
    `ffprobe -v error -show_streams -print_format json "${localPath}"`,
    { encoding: 'utf-8' }
  );
  const streams = JSON.parse(streamsJson).streams || [];
  for (const s of streams) {
    console.log(`Stream #${s.index} (${s.codec_type}): codec=${s.codec_name}, profile=${s.profile}, pix_fmt=${s.pix_fmt}, time_base=${s.time_base}, start_pts=${s.start_pts}, start_time=${s.start_time}`);
  }

  // 2. First 10 video packets (PTS, DTS, keyframe, size)
  const packetsJson = execSync(
    `ffprobe -v error -select_streams v:0 -show_packets -show_entries packet=pts,pts_time,dts,dts_time,flags,size -read_intervals "%+#15" -print_format json "${localPath}"`,
    { encoding: 'utf-8' }
  );
  const packets = JSON.parse(packetsJson).packets || [];
  console.log(`\nFirst ${packets.length} video packets:`);
  for (let i = 0; i < Math.min(packets.length, 10); i++) {
    const p = packets[i];
    console.log(`  pkt[${i}]: dts_time=${p.dts_time}, pts_time=${p.pts_time}, flags=${p.flags}, size=${p.size}`);
  }

  // 3. First 5 audio packets
  const audioPacketsJson = execSync(
    `ffprobe -v error -select_streams a:0 -show_packets -show_entries packet=pts,pts_time,dts,dts_time,flags,size -read_intervals "%+#5" -print_format json "${localPath}"`,
    { encoding: 'utf-8' }
  );
  const audioPackets = JSON.parse(audioPacketsJson).packets || [];
  console.log(`\nFirst audio packets:`);
  for (let i = 0; i < Math.min(audioPackets.length, 5); i++) {
    const p = audioPackets[i];
    console.log(`  audio_pkt[${i}]: pts_time=${p.pts_time}, flags=${p.flags}, size=${p.size}`);
  }

  // 4. Frames analysis: key_frame, pict_type, pkt_pts_time
  const framesJson = execSync(
    `ffprobe -v error -select_streams v:0 -show_frames -show_entries frame=pkt_pts_time,key_frame,pict_type,coded_picture_number -read_intervals "%+#15" -print_format json "${localPath}"`,
    { encoding: 'utf-8' }
  );
  const frames = JSON.parse(framesJson).frames || [];
  console.log(`\nFirst ${frames.length} video decoded frames:`);
  for (let i = 0; i < Math.min(frames.length, 10); i++) {
    const f = frames[i];
    console.log(`  frame[${i}]: pts_time=${f.pkt_pts_time}, key_frame=${f.key_frame}, pict_type=${f.pict_type}, coded_num=${f.coded_picture_number}`);
  }

  // 5. Total frames & duration
  const formatJson = execSync(
    `ffprobe -v error -show_format -print_format json "${localPath}"`,
    { encoding: 'utf-8' }
  );
  const format = JSON.parse(formatJson).format || {};
  console.log(`\nContainer: duration=${format.duration}, bit_rate=${format.bit_rate}, start_time=${format.start_time}`);

  // 6. Test independent decoding with ffmpeg
  try {
    const decodeCheck = execSync(
      `ffmpeg -v error -i "${localPath}" -f null - 2>&1`,
      { encoding: 'utf-8' }
    );
    console.log(`Independent decoding check: ${decodeCheck.trim() || 'PERFECT (0 decoding errors)'}`);
  } catch (err) {
    console.log(`Independent decoding check ERROR: ${err.message}`);
  }
}

async function run() {
  const baseKey = 'hls/PHARMACY-4/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4_360p_';
  const seg1 = '00001.ts';
  const seg2 = '00002.ts';
  const seg3 = '00003.ts';

  const path1 = path.join(scratchDir, seg1);
  const path2 = path.join(scratchDir, seg2);
  const path3 = path.join(scratchDir, seg3);

  await downloadSegment(baseKey + seg1, path1);
  await downloadSegment(baseKey + seg2, path2);
  await downloadSegment(baseKey + seg3, path3);

  probeSegment(path1, 'Segment 1 (Normal playback start, 0s-6s)');
  probeSegment(path2, 'Segment 2 (Immediately after seek to 10s, 6s-12s)');
  probeSegment(path3, 'Segment 3 (Following segment, 12s-18s)');
}

run().catch(e => console.error(e));

