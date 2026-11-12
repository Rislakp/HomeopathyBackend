#!/usr/bin/env node
/**
 * Bulk-converts every course/recording video to a 720p seek-safe iOS MP4
 * (`<original>_ios.mp4`) using AWS MediaConvert, then waits for the jobs and
 * updates the database so students get the new file (played through CloudFront).
 *
 * Safe to re-run: videos that are already done are skipped, and jobs that are
 * still running are just checked again.
 *
 * Usage:
 *   node scripts/bulk_ios_mp4_mediaconvert.js --dry-run          # list videos, change nothing
 *   node scripts/bulk_ios_mp4_mediaconvert.js --key=pharmacy-5   # only keys containing this text
 *   node scripts/bulk_ios_mp4_mediaconvert.js                    # all videos
 *
 * Options:
 *   --dry-run            Only list videos and their current status
 *   --key=TEXT           Only videos whose S3 key contains TEXT (case-insensitive)
 *   --limit=N            Submit at most N new jobs this run
 *   --force              Convert again even if a 720p MP4 already exists
 *   --no-wait            Submit jobs and exit without waiting for them
 *   --poll-seconds=N     How often to check running jobs (default 30)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const VideoConversion = require('../models/VideoConversion');
const { getM4vKeyForOriginal } = require('../services/videoConversionService');
const { discoverCourseVideos } = require('../services/iosMp4Sweeper');
const { submitIosMp4Job, checkIosMp4Job } = require('../services/iosMp4MediaConvertService');

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const NO_WAIT = args.includes('--no-wait');
const KEY_FILTER = (getArg('key') || '').toLowerCase();
const LIMIT = parseInt(getArg('limit'), 10) || Infinity;
const POLL_MS = (parseInt(getArg('poll-seconds'), 10) || 30) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discoverVideos() {
  const videos = await discoverCourseVideos();
  return videos.filter((v) => !KEY_FILTER || v.s3Key.toLowerCase().includes(KEY_FILTER));
}

async function main() {
  await connectDB();
  const videos = await discoverVideos();
  console.info(`Found ${videos.length} video(s)${KEY_FILTER ? ` matching "${KEY_FILTER}"` : ''}.`);

  if (DRY_RUN) {
    for (const v of videos) {
      const rec = await VideoConversion.findOne({ originalS3Key: v.s3Key }).lean();
      const state = rec?.encodeProfile && rec.status === 'completed' ? `done (${rec.encodeProfile})` : (rec?.status || 'none');
      console.info(`  [${state}] ${v.s3Key} -> ${getM4vKeyForOriginal(v.s3Key)}   (${v.source})`);
    }
    return;
  }

  // 1. Submit jobs (MediaConvert queues them and runs many in parallel).
  const running = new Map(); // jobId -> s3Key
  let submitted = 0;
  let alreadyDone = 0;
  const failedToSubmit = [];
  for (const v of videos) {
    if (submitted >= LIMIT) break;
    try {
      const r = await submitIosMp4Job(v.s3Key, { force: FORCE });
      if (r.state === 'done') alreadyDone += 1;
      else running.set(r.jobId, r.s3Key);
      if (r.state === 'submitted') {
        submitted += 1;
        console.info(`  submitted ${r.s3Key} (job ${r.jobId})`);
      }
    } catch (err) {
      failedToSubmit.push(v.s3Key);
      console.error(`  could not submit ${v.s3Key}: ${err.message}`);
    }
  }
  console.info(`\nSubmitted ${submitted}, already done ${alreadyDone}, running ${running.size}, submit errors ${failedToSubmit.length}.`);

  if (NO_WAIT || running.size === 0) return;

  // 2. Wait for the jobs and update the database as each one finishes.
  const total = running.size;
  const failedJobs = [];
  while (running.size > 0) {
    await sleep(POLL_MS);
    for (const [jobId, s3Key] of Array.from(running)) {
      try {
        const r = await checkIosMp4Job(jobId);
        if (r.status === 'completed') {
          running.delete(jobId);
          console.info(`  done ${s3Key} -> ${r.targetKey}`);
        } else if (r.status === 'failed') {
          running.delete(jobId);
          failedJobs.push(s3Key);
          console.error(`  FAILED ${s3Key}: ${r.error}`);
        }
      } catch (err) {
        console.warn(`  could not check job ${jobId} (${s3Key}): ${err.message}`);
      }
    }
    console.info(`Progress: ${total - running.size}/${total} finished, ${running.size} still running.`);
  }

  console.info(`\nAll jobs finished. Failed: ${failedJobs.length + failedToSubmit.length}.`);
  for (const k of [...failedJobs, ...failedToSubmit]) console.info(`  - ${k}`);
}

main()
  .catch((err) => {
    console.error('Bulk conversion stopped:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
