/**
 * Decides what a student should be given for an uploaded video:
 *
 * - "ready":      the seek-safe _ios.mp4 exists -> play it.
 * - "processing": it is still being made -> show a "being prepared" message
 *                 instead of the original, which can freeze on seek or time out.
 * - "original":   no conversion is expected (or it is stuck/failed for longer
 *                 than MAX_HIDE_MS) -> fall back to the original so the video
 *                 never disappears.
 *
 * Set HIDE_UNCONVERTED_VIDEOS=false to always fall back to the original.
 */
const mongoose = require('mongoose');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucket } = require('../config/s3');
const VideoConversion = require('../models/VideoConversion');
const { SAFE_S3_KEY } = require('./s3MediaSigner');
const { isIosRenditionKey } = require('./iosRendition');

const SEEK_SAFE_PROFILES = ['ios-seek-v2', 'mediaconvert-720p-v1'];
const MAX_HIDE_MS = 3 * 60 * 60 * 1000; // never hide a video for more than 3 hours
const NEW_UPLOAD_MS = 60 * 60 * 1000; // a video with no record yet counts as new for 1 hour
const MAX_ATTEMPTS = 3;

const PROCESSING_MESSAGE = 'This video is being prepared for smooth playback. Please check back in a few minutes.';
const RETRY_AFTER_SECONDS = 60;

const isEnabled = () => process.env.HIDE_UNCONVERTED_VIDEOS !== 'false';

function uploadedAtMs(key) {
  const m = /(?:^|\/)(\d{13})-/.exec(String(key || ''));
  return m ? Number(m[1]) : 0;
}

const isSafeVideoKey = (key) => typeof key === 'string' && SAFE_S3_KEY.test(key) &&
  /^(videos|live_records)\//.test(key) && !key.includes('..') && !key.includes('//');

async function renditionExists(key) {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return Number(head?.ContentLength) > 0;
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} s3Key original video key
 * @param {{ now?: number, record?: object|null }} [options] record: an already-loaded VideoConversion
 * @returns {Promise<{ state: 'ready'|'processing'|'original', renditionKey?: string }>}
 */
async function getIosPlaybackState(s3Key, options = {}) {
  const key = String(s3Key || '').trim();
  if (!isSafeVideoKey(key) || isIosRenditionKey(key)) return { state: 'original' };

  let record = options.record;
  if (record === undefined) {
    // Without a database connection (and no test stub) a query would just wait and time out.
    const dbReady = mongoose.connection?.readyState === 1 || VideoConversion.findOne !== mongoose.Model.findOne;
    if (!dbReady) return { state: 'original' };
    try {
      record = await VideoConversion.findOne({ originalS3Key: key }).lean();
    } catch (_) {
      return { state: 'original' };
    }
  }

  const renditionKey = String(record?.m4vS3Key || '').trim();
  if (record?.status === 'completed' && SEEK_SAFE_PROFILES.includes(record.encodeProfile) &&
      isSafeVideoKey(renditionKey) && isIosRenditionKey(renditionKey) && await renditionExists(renditionKey)) {
    return { state: 'ready', renditionKey };
  }

  if (!isEnabled()) return { state: 'original' };

  const now = options.now || Date.now();
  const uploaded = uploadedAtMs(key);
  const since = record?.lastAttemptAt ? new Date(record.lastAttemptAt).getTime() : uploaded;
  if (!since || now - since > MAX_HIDE_MS) return { state: 'original' };

  const status = record?.status;
  const stillWorking = status === 'processing' || status === 'pending' ||
    (status === 'failed' && (record.attempts || 0) < MAX_ATTEMPTS) ||
    (!record && uploaded && now - uploaded < NEW_UPLOAD_MS);
  return stillWorking ? { state: 'processing' } : { state: 'original' };
}

const PLAYABLE_FIELDS = [
  'url', 'secure_url', 'secureUrl', 'fileUrl', 'videoUrl', 'mediaUrl', 'path', 'documentUrl',
  'mp4Url', 'fallbackVideoUrl', 'fallbackMp4Url', 'originalVideoUrl', 'hlsMasterUrl', 'hlsPlaybackUrl',
];

/** Removes every playable link from a video object and marks it as being prepared. */
function markProcessing(item) {
  for (const field of PLAYABLE_FIELDS) if (item[field]) item[field] = '';
  item.videoProcessing = true;
  item.videoStatus = 'processing';
  item.playbackType = 'processing';
  item.processingMessage = PROCESSING_MESSAGE;
  item.retryAfterSeconds = RETRY_AFTER_SECONDS;
  return item;
}

module.exports = {
  getIosPlaybackState,
  markProcessing,
  uploadedAtMs,
  PROCESSING_MESSAGE,
  RETRY_AFTER_SECONDS,
  MAX_HIDE_MS,
};
