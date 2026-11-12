/**
 * Background safety net for the 720p iOS MP4 renditions.
 *
 * Runs every few minutes on the API server and:
 * 1. Checks MediaConvert jobs that are still marked "processing" and records the
 *    result (so it works even when the MediaConvert webhook is not set up).
 * 2. Starts a conversion for any course/recording video that has none yet
 *    (e.g. a video added through a path that does not trigger conversion).
 * 3. Retries failed conversions, up to MAX_ATTEMPTS times.
 *
 * Disable with IOS_SWEEPER_DISABLED=true.
 */
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const { isConvertibleVideoKey, IOS_ENCODE_PROFILE, IOS_MP4_MEDIACONVERT_PROFILE } = require('./videoConversionService');
const { submitIosMp4Job, checkIosMp4Job } = require('./iosMp4MediaConvertService');

const SEEK_SAFE_PROFILES = [IOS_ENCODE_PROFILE, IOS_MP4_MEDIACONVERT_PROFILE];
const MAX_ATTEMPTS = 3;
const MAX_NEW_JOBS_PER_RUN = 10;
const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

// Turns a stored key or S3/CloudFront URL into an S3 key.
function toS3Key(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''));
    } catch (_) {
      return '';
    }
  }
  return isConvertibleVideoKey(value) ? value : '';
}

/** All original video keys used by course lessons and recordings: [{ s3Key, source }]. */
async function discoverCourseVideos() {
  const found = new Map();
  const add = (raw, source) => {
    const key = toS3Key(raw);
    if (key && !found.has(key)) found.set(key, source);
  };

  const courses = await Course.find({}).lean();
  for (const course of courses) {
    const courseId = String(course.courseId || course._id);
    for (const mod of course.modules || []) {
      for (const lesson of mod.lessons || []) {
        const source = `Course ${courseId} / ${lesson.lessonTitle || lesson._id}`;
        for (const k of [lesson.s3Key, lesson.videoS3Key, lesson.videoUrl]) add(k, source);
        for (const vp of lesson.videoParts || []) for (const k of [vp.s3Key, vp.url, vp.secure_url]) add(k, source);
      }
    }
  }
  const recordings = await Recording.find({}).lean();
  for (const rec of recordings) {
    for (const k of [rec.s3Key, rec.recordedVideoUrl, rec.recordingFileUrl]) add(k, `Recording ${rec._id}`);
  }
  return Array.from(found, ([s3Key, source]) => ({ s3Key, source }));
}

function isSeekSafeDone(record) {
  return record?.status === 'completed' && SEEK_SAFE_PROFILES.includes(record.encodeProfile);
}

async function runIosMp4Sweep({ maxNewJobs = MAX_NEW_JOBS_PER_RUN } = {}) {
  const summary = { checked: 0, completed: 0, failed: 0, submitted: 0, errors: 0 };

  // 1. Finish jobs that are still marked as running.
  const running = await VideoConversion.find({ status: 'processing', iosMp4JobId: { $nin: ['', null] } }).lean();
  for (const rec of running) {
    try {
      const r = await checkIosMp4Job(rec.iosMp4JobId);
      summary.checked += 1;
      if (r.status === 'completed') summary.completed += 1;
      if (r.status === 'failed') summary.failed += 1;
    } catch (err) {
      summary.errors += 1;
      console.warn(`[iOS MP4 sweep] Could not check job ${rec.iosMp4JobId} (${rec.originalS3Key}): ${err.message}`);
    }
  }

  // 2 + 3. Start missing conversions and retry failed ones.
  const videos = await discoverCourseVideos();
  const records = await VideoConversion.find({ originalS3Key: { $in: videos.map((v) => v.s3Key) } }).lean();
  const byKey = new Map(records.map((r) => [r.originalS3Key, r]));
  for (const { s3Key } of videos) {
    if (summary.submitted >= maxNewJobs) break;
    const rec = byKey.get(s3Key);
    if (isSeekSafeDone(rec)) continue;
    if (rec?.status === 'processing' && rec.iosMp4JobId) continue;
    if (rec?.status === 'failed' && (rec.attempts || 0) >= MAX_ATTEMPTS) continue;
    try {
      const r = await submitIosMp4Job(s3Key);
      if (r.state === 'submitted') summary.submitted += 1;
    } catch (err) {
      summary.errors += 1;
      console.warn(`[iOS MP4 sweep] Could not submit ${s3Key}: ${err.message}`);
    }
  }

  if (summary.checked || summary.submitted || summary.errors) {
    console.info('[iOS MP4 sweep]', summary);
  }
  return summary;
}

let timer = null;
let sweeping = false;

function startIosMp4Sweeper() {
  if (timer || process.env.IOS_SWEEPER_DISABLED === 'true' || process.env.NODE_ENV === 'test') return false;
  const tick = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await runIosMp4Sweep();
    } catch (err) {
      console.error('[iOS MP4 sweep] Run failed:', err.message);
    } finally {
      sweeping = false;
    }
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  console.info('[iOS MP4 sweep] Started (every 10 minutes).');
  return true;
}

module.exports = {
  discoverCourseVideos,
  runIosMp4Sweep,
  startIosMp4Sweeper,
  MAX_ATTEMPTS,
};
