#!/usr/bin/env node

/**
 * Resumable Batch Migration Utility for AWS Elemental MediaConvert HLS
 *
 * Scans all existing videos across Courses, Lessons, Recordings, and DemoVideos.
 * Automatically submits MediaConvert jobs with controlled concurrency, idempotency,
 * and resume support after interruption.
 *
 * Usage:
 *   node scripts/migrate_videos_to_hls.js [options]
 *
 * Options:
 *   --concurrency=N   Maximum concurrent MediaConvert job submissions (default: 3)
 *   --limit=N         Maximum number of videos to submit in this run
 *   --dry-run         Scan and display eligible videos without submitting jobs
 *   --force           Re-submit jobs even if previously failed or marked pending
 *   --state-file=F    Custom path for migration state file (default: scratch/hls_migration_state.json)
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const {
  isEligibleVideoKey,
  deriveVideoIdFromKey,
  submitHlsConversionJob,
  getCloudFrontHlsMasterUrl,
} = require('../services/mediaConvertService');

const Course = require('../models/Course');
const Recording = require('../models/Recording');
const DemoVideo = require('../models/DemoVideo');
const VideoConversion = require('../models/VideoConversion');

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
const limitArg = args.find((a) => a.startsWith('--limit='));
const stateFileArg = args.find((a) => a.startsWith('--state-file='));

const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) || 3 : 3;
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const STATE_FILE = stateFileArg
  ? path.resolve(stateFileArg.split('=')[1])
  : path.join(__dirname, '../scratch/hls_migration_state.json');

// Ensure scratch directory exists
const stateDir = path.dirname(STATE_FILE);
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

// Load or initialize persistent migration state
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (_) {}
  }
  return {
    startedAt: new Date().toISOString(),
    completedKeys: {},
    submittedKeys: {},
    failedKeys: {},
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Migration State] Failed to save state file:', err.message);
  }
}

/**
 * Extracts a candidate S3 key from a raw string or URL.
 */
function extractS3Key(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (isEligibleVideoKey(trimmed)) return trimmed;
  if (trimmed.includes('amazonaws.com/')) {
    const parts = trimmed.split('amazonaws.com/');
    const key = decodeURIComponent(parts[1]?.split('?')[0] || '');
    if (isEligibleVideoKey(key)) return key;
  }
  return '';
}

/**
 * Collects all eligible video references from MongoDB.
 */
async function discoverEligibleVideos() {
  const discovered = new Map(); // key -> { s3Key, source, courseId, lessonId, videoId }

  console.info('[Discovery] Scanning Courses for lesson videos and videoParts...');
  const courses = await Course.find({}).lean();
  for (const course of courses) {
    const courseId = String(course.courseId || course._id);
    for (const mod of course.modules || []) {
      const moduleId = String(mod._id || '');
      for (const lesson of mod.lessons || []) {
        const lessonId = String(lesson._id || '');

        // 1. Direct lesson video keys
        for (const k of [lesson.s3Key, lesson.videoS3Key, lesson.videoUrl]) {
          const key = extractS3Key(k);
          if (key && !discovered.has(key)) {
            discovered.set(key, {
              s3Key: key,
              source: `Course ${courseId} -> Lesson ${lessonId}`,
              courseId,
              moduleId,
              lessonId,
              title: lesson.lessonTitle,
            });
          }
        }

        // 2. videoParts
        for (const vp of lesson.videoParts || []) {
          for (const k of [vp.s3Key, vp.url, vp.secure_url]) {
            const key = extractS3Key(k);
            if (key && !discovered.has(key)) {
              discovered.set(key, {
                s3Key: key,
                source: `Course ${courseId} -> Lesson ${lessonId} -> videoPart`,
                courseId,
                moduleId,
                lessonId,
                title: vp.title || lesson.lessonTitle,
              });
            }
          }
        }
      }
    }
  }

  console.info('[Discovery] Scanning Recordings...');
  const recordings = await Recording.find({}).lean();
  for (const rec of recordings) {
    for (const k of [rec.s3Key, rec.recordedVideoUrl, rec.recordingFileUrl, rec.streamUrl]) {
      const key = extractS3Key(k);
      if (key && !discovered.has(key)) {
        discovered.set(key, {
          s3Key: key,
          source: `Recording ${rec._id}`,
          recordingId: String(rec._id),
          title: rec.lessonTitle || rec.courseName,
        });
      }
    }
  }

  console.info('[Discovery] Scanning DemoVideos...');
  const demoVideos = await DemoVideo.find({}).lean();
  for (const dv of demoVideos) {
    for (const k of [dv.s3Key, dv.videoUrl]) {
      const key = extractS3Key(k);
      if (key && !discovered.has(key)) {
        discovered.set(key, {
          s3Key: key,
          source: `DemoVideo ${dv._id}`,
          title: dv.title,
        });
      }
    }
  }

  return Array.from(discovered.values());
}

/**
 * Concurrency throttler executing an array of tasks with a fixed concurrency limit.
 */
async function runWithConcurrency(items, concurrencyLimit, workerFn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        const res = await workerFn(items[currentIndex], currentIndex, items.length);
        results[currentIndex] = { success: true, ...res };
      } catch (err) {
        results[currentIndex] = { success: false, error: err.message, item: items[currentIndex] };
      }
    }
  }

  const pool = Array.from({ length: Math.min(concurrencyLimit, items.length) }, () => worker());
  await Promise.all(pool);
  return results;
}

async function runMigration() {
  console.log('================================================================');
  console.log(' AWS Elemental MediaConvert HLS Resumable Video Migration Utility');
  console.log('================================================================');
  console.log(`Concurrency: ${CONCURRENCY} concurrent jobs`);
  console.log(`Mode:        ${isDryRun ? 'DRY-RUN (read-only)' : 'LIVE EXECUTION'}`);
  console.log(`Force:       ${isForce ? 'YES (override existing states)' : 'NO (skip completed/in-progress)'}`);
  console.log(`State File:  ${STATE_FILE}`);
  console.log('----------------------------------------------------------------');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGO_URI is not set in environment.');
    process.exit(1);
  }

  console.info('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  console.info('MongoDB connected cleanly.\n');

  const allVideos = await discoverEligibleVideos();
  console.info(`Found ${allVideos.length} total unique video references in database.\n`);

  const state = loadState();

  // Classify each video
  const toProcess = [];
  let alreadyCompletedCount = 0;
  let inProgressCount = 0;

  for (const vid of allVideos) {
    const key = vid.s3Key;
    const videoId = deriveVideoIdFromKey(key);
    vid.videoId = videoId;

    if (!isForce) {
      // 1. Check persistent migration state file
      if (state.completedKeys[key]) {
        alreadyCompletedCount++;
        continue;
      }

      // 2. Check VideoConversion collection in DB
      const dbRecord = await VideoConversion.findOne({ originalS3Key: key }).lean();
      const status = String(dbRecord?.hlsConversionStatus || '').toUpperCase();
      if (status === 'COMPLETED' && dbRecord?.hlsMasterUrl) {
        alreadyCompletedCount++;
        state.completedKeys[key] = {
          videoId,
          jobId: dbRecord.mediaConvertJobId,
          completedAt: dbRecord.hlsConvertedAt || new Date().toISOString(),
        };
        continue;
      }
      if (['PROCESSING', 'PENDING'].includes(status) && dbRecord?.mediaConvertJobId) {
        inProgressCount++;
        state.submittedKeys[key] = {
          videoId,
          jobId: dbRecord.mediaConvertJobId,
          submittedAt: dbRecord.updatedAt || new Date().toISOString(),
        };
        continue;
      }
    }

    toProcess.push(vid);
  }

  saveState(state);

  console.log('--- Migration Pre-flight Summary ---');
  console.log(`Total Videos Discovered: ${allVideos.length}`);
  console.log(`Already Completed (skip): ${alreadyCompletedCount}`);
  console.log(`In-Progress/Pending:      ${inProgressCount}`);
  console.log(`Remaining to Process:     ${toProcess.length}`);
  console.log('------------------------------------\n');

  const finalQueue = toProcess.slice(0, LIMIT);
  if (finalQueue.length === 0) {
    console.log('No videos require migration at this time. All videos are completed or in progress.');
    await mongoose.disconnect();
    return;
  }

  if (isDryRun) {
    console.log('DRY-RUN: Listing candidate videos for migration:');
    finalQueue.forEach((item, idx) => {
      console.log(`  [${idx + 1}/${finalQueue.length}] ${item.s3Key} (${item.title || item.source})`);
      console.log(`     -> Target Output: hls/${item.videoId}/${item.videoId}.m3u8`);
    });
    console.log('\nDRY-RUN completed. No jobs submitted.');
    await mongoose.disconnect();
    return;
  }

  console.info(`Starting batch submission of ${finalQueue.length} jobs (concurrency: ${CONCURRENCY})...\n`);

  let submittedCount = 0;
  let failedCount = 0;

  const results = await runWithConcurrency(finalQueue, CONCURRENCY, async (item, idx, total) => {
    const key = item.s3Key;
    const videoId = item.videoId;
    console.info(`[${idx + 1}/${total}] Submitting MediaConvert job for: ${key}...`);

    try {
      const res = await submitHlsConversionJob({
        s3Key: key,
        videoId,
        userMetadata: {
          s3Key: key,
          courseId: item.courseId || '',
          moduleId: item.moduleId || '',
          lessonId: item.lessonId || '',
          recordingId: item.recordingId || '',
        },
        force: isForce,
      });

      console.info(`✔ [${idx + 1}/${total}] Successfully queued: ${key} -> JobId: ${res.jobId} (HLS: ${res.hlsMasterUrl})`);
      state.submittedKeys[key] = {
        videoId,
        jobId: res.jobId,
        submittedAt: new Date().toISOString(),
      };
      saveState(state);
      submittedCount++;
      return { key, videoId, jobId: res.jobId, status: res.status };
    } catch (err) {
      console.error(`✖ [${idx + 1}/${total}] Failed to submit ${key}: ${err.message}`);
      state.failedKeys[key] = {
        videoId,
        error: err.message,
        failedAt: new Date().toISOString(),
      };
      saveState(state);
      failedCount++;
      throw err;
    }
  });

  console.log('\n================================================================');
  console.log(' Migration Batch Submission Completed');
  console.log('================================================================');
  console.log(`Submitted Jobs: ${submittedCount}`);
  console.log(`Failed Jobs:    ${failedCount}`);
  console.log(`State saved to: ${STATE_FILE}`);
  console.log('----------------------------------------------------------------');
  console.log('Next steps: MediaConvert jobs are being processed asynchronously by AWS.');
  console.log('Job completions will be handled automatically by the EventBridge webhook.');
  console.log('================================================================');

  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('FATAL Migration Error:', err);
    process.exit(1);
  });
}

module.exports = {
  discoverEligibleVideos,
  extractS3Key,
  runMigration,
};

