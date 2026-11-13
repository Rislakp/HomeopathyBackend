#!/usr/bin/env node
/**
 * Shows, for each matching video, everything that decides what a student plays:
 * conversion record, S3 files, MediaConvert job, lesson fields, and the exact
 * URLs the student course API returns (query strings hidden).
 *
 * Read-only: changes nothing.
 *
 * Usage:
 *   node scripts/diagnose_video_playback.js                 # videos uploaded in the last 2 days
 *   node scripts/diagnose_video_playback.js --days=7
 *   node scripts/diagnose_video_playback.js --key=PHARMACY-4  # S3 key contains this text
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { GetJobCommand } = require('@aws-sdk/client-mediaconvert');

const connectDB = require('../config/db');
const { s3Client, bucket } = require('../config/s3');
const { getMediaConvertClient } = require('../config/mediaconvert');
const Course = require('../models/Course');
const VideoConversion = require('../models/VideoConversion');
const { getM4vKeyForOriginal } = require('../services/videoConversionService');
const { discoverCourseVideos } = require('../services/iosMp4Sweeper');
const { addSignedS3MediaUrls } = require('../controllers/studentCurriculumController');

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const KEY_FILTER = (getArg('key') || '').toLowerCase();
const DAYS = parseFloat(getArg('days')) || 2;

// Hide signatures: keep host + path only.
const short = (url) => {
  if (!url || typeof url !== 'string') return '(none)';
  try {
    const u = new URL(url);
    return `${u.host}${decodeURIComponent(u.pathname)}${u.search ? ' [signed]' : ''}`;
  } catch (_) {
    return url.split('?')[0];
  }
};

async function head(key) {
  try {
    const h = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return `yes, ${(Number(h.ContentLength) / 1048576).toFixed(1)} MB, ${h.ContentType}`;
  } catch (err) {
    return `NO (${err.name || err.message})`;
  }
}

async function job(jobId) {
  if (!jobId) return '(no job id)';
  try {
    const client = await getMediaConvertClient();
    const j = (await client.send(new GetJobCommand({ Id: jobId }))).Job;
    const pct = j.JobPercentComplete != null ? ` ${j.JobPercentComplete}%` : '';
    return `${j.Status}${pct}${j.ErrorMessage ? ` - ${j.ErrorMessage}` : ''}`;
  } catch (err) {
    return `could not read (${err.message})`;
  }
}

function uploadedAt(key) {
  const m = /\/(\d{13})-/.exec(key);
  return m ? Number(m[1]) : 0;
}

async function main() {
  await connectDB();
  const since = Date.now() - DAYS * 86400000;
  const videos = (await discoverCourseVideos()).filter((v) => (KEY_FILTER
    ? v.s3Key.toLowerCase().includes(KEY_FILTER)
    : uploadedAt(v.s3Key) >= since));
  console.info(`\nChecking ${videos.length} video(s)${KEY_FILTER ? ` matching "${KEY_FILTER}"` : ` uploaded in the last ${DAYS} day(s)`}.\n`);

  for (const { s3Key, source } of videos) {
    const target = getM4vKeyForOriginal(s3Key);
    const rec = await VideoConversion.findOne({ originalS3Key: s3Key }).lean();
    console.info('='.repeat(90));
    console.info(`VIDEO   ${s3Key}`);
    console.info(`WHERE   ${source}`);
    if (uploadedAt(s3Key)) console.info(`UPLOAD  ${new Date(uploadedAt(s3Key)).toISOString()}`);
    console.info(`S3 original : ${await head(s3Key)}`);
    console.info(`S3 _ios.mp4 : ${await head(target)}`);
    console.info(`Record      : status=${rec?.status || '(none)'} profile=${rec?.encodeProfile || '-'} m4vS3Key=${rec?.m4vS3Key || '-'} attempts=${rec?.attempts || 0}${rec?.error ? ` error="${rec.error}"` : ''}`);
    console.info(`iOS MP4 job : ${await job(rec?.iosMp4JobId)}`);
    console.info(`HLS         : status=${rec?.hlsConversionStatus || '-'} master=${rec?.hlsMasterUrl ? 'yes' : 'no'}${rec?.hlsConversionError ? ` error="${rec.hlsConversionError}"` : ''}`);

    // What the student API returns for the lesson(s) holding this video.
    const courses = await Course.find({
      $or: [
        { 'modules.lessons.s3Key': s3Key },
        { 'modules.lessons.videoS3Key': s3Key },
        { 'modules.lessons.videoParts.s3Key': s3Key },
        { 'modules.lessons.videoUrl': { $regex: s3Key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
      ],
    }).lean();
    for (const course of courses) {
      const served = await addSignedS3MediaUrls(JSON.parse(JSON.stringify(course)));
      for (const mod of served.modules || []) {
        for (const lesson of mod.lessons || []) {
          const parts = lesson.videoParts || [];
          const holds = lesson.s3Key === s3Key || lesson.videoS3Key === s3Key ||
            String(lesson.videoUrl || '').includes(s3Key) || parts.some((p) => p.s3Key === s3Key);
          if (!holds) continue;
          console.info(`-- Student API: course ${course.courseId || course._id} / lesson "${lesson.lessonTitle}"`);
          console.info(`   playbackType     : ${lesson.playbackType || '-'}`);
          console.info(`   videoUrl         : ${short(lesson.videoUrl)}`);
          console.info(`   iosVideoUrl      : ${short(lesson.iosVideoUrl)}`);
          console.info(`   hlsPlaybackUrl   : ${short(lesson.hlsPlaybackUrl)}`);
          console.info(`   m4vConversion    : ${lesson.m4vConversionStatus || '-'}`);
          parts.forEach((p, i) => console.info(`   videoParts[${i}].url : ${short(p.url)}  (s3Key ${p.s3Key || '-'}, storage ${p.storageProvider || '-'})`));
        }
      }
    }
    if (!courses.length) console.info('-- Not found in any course lesson (recording only?)');
  }
  console.info('='.repeat(90));
}

main()
  .catch((err) => {
    console.error('Diagnosis stopped:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
