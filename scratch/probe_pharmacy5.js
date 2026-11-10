const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { execSync } = require('child_process');

async function run() {
  const targetKey = 'videos/1792901482685-b6f9f03b-2170-4039-80b6-fc503a2d5593-pharmacy-5.mp4';
  const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    ResponseContentType: 'video/mp4',
    ResponseContentDisposition: 'inline',
  }), { expiresIn: 3600 });

  console.log('Running ffprobe on pharmacy-5.mp4...');
  try {
    const probeJson = execSync(
      `ffprobe -v error -show_format -show_streams -print_format json "${signedUrl}"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
    );
    const info = JSON.parse(probeJson);
    console.log('Format Info:', {
      format_name: info.format.format_name,
      duration: info.format.duration,
      size: info.format.size,
      bit_rate: info.format.bit_rate,
      tags: info.format.tags,
    });
    console.log('Streams:');
    for (const s of info.streams) {
      console.log({
        index: s.index,
        codec_type: s.codec_type,
        codec_name: s.codec_name,
        profile: s.profile,
        codec_tag_string: s.codec_tag_string,
        width: s.width,
        height: s.height,
        pix_fmt: s.pix_fmt,
        r_frame_rate: s.r_frame_rate,
        avg_frame_rate: s.avg_frame_rate,
        sample_rate: s.sample_rate,
        channels: s.channels,
        channel_layout: s.channel_layout,
        bit_rate: s.bit_rate,
      });
    }
  } catch (err) {
    console.error('ffprobe error:', err.message);
  }
}

run();

