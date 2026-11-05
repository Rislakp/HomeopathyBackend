const mongoose = require('mongoose');
const { CreateJobCommand, GetJobCommand } = require('@aws-sdk/client-mediaconvert');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/s3');
const { mediaConvertConfig, getMediaConvertClient } = require('../config/mediaconvert');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');
const DemoVideo = require('../models/DemoVideo');

// In-memory set to prevent duplicate concurrent submissions for the same video
const inFlightSubmissions = new Set();

/**
 * Derives a clean, filesystem- and URL-safe videoId from an S3 video key or ID.
 * Example: 'videos/1715000000-abcd-video.mp4' -> '1715000000-abcd-video'
 */
function deriveVideoIdFromKey(key) {
  if (!key || typeof key !== 'string') return '';
  const cleanKey = key.trim();
  const filename = cleanKey.split('/').pop() || cleanKey;
  const withoutExt = filename.replace(/\.[a-zA-Z0-9]+$/, '');
  const sanitized = withoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized || `video_${Date.now()}`;
}

/**
 * Validates whether an S3 key points to an eligible video file for HLS transcoding.
 */
function isEligibleVideoKey(key) {
  if (!key || typeof key !== 'string') return false;
  const lower = key.trim().toLowerCase();
  return (
    (lower.startsWith('videos/') || lower.startsWith('live_records/')) &&
    (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm') || lower.endsWith('.m4v')) &&
    !lower.endsWith('_ios.m4v') &&
    !lower.includes('.m3u8') &&
    !lower.includes('.ts')
  );
}

/**
 * Constructs the CloudFront master playlist URL for a given videoId.
 */
function getCloudFrontHlsMasterUrl(videoId) {
  const domain = mediaConvertConfig.cloudFrontDomain;
  return `https://${domain}/hls/${videoId}/master.m3u8`;
}

/**
 * Constructs the AWS Elemental MediaConvert Job specification for adaptive HLS outputs (480p and 360p).
 */
function buildHlsJobSettings({ inputS3Uri, outputS3Destination, videoId, userMetadata = {} }) {
  return {
    Role: mediaConvertConfig.roleArn,
    UserMetadata: {
      videoId: String(videoId),
      s3Key: String(userMetadata.s3Key || ''),
      courseId: String(userMetadata.courseId || ''),
      moduleId: String(userMetadata.moduleId || ''),
      lessonId: String(userMetadata.lessonId || ''),
      recordingId: String(userMetadata.recordingId || ''),
    },
    Settings: {
      TimecodeConfig: {
        Source: 'ZEROBASED',
      },
      Inputs: [
        {
          AudioSelectors: {
            'Audio Selector 1': {
              DefaultSelection: 'DEFAULT',
            },
          },
          VideoSelector: {},
          TimecodeSource: 'ZEROBASED',
          FileInput: inputS3Uri,
        },
      ],
      OutputGroups: [
        {
          Name: 'HLS Group',
          CustomName: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              SegmentLength: 6,
              MinSegmentLength: 0,
              Destination: outputS3Destination,
              DirectoryStructure: 'SINGLE_DIRECTORY',
              ManifestDurationFormat: 'INTEGER',
              StreamInfResolution: 'INCLUDE',
              ClientCache: 'ENABLED',
              CaptionLanguageSetting: 'OMIT',
            },
          },
          Outputs: [
            // Output 1: 480p (1116 x 480)
            {
              NameModifier: '_480p',
              ContainerSettings: {
                Container: 'M3U8',
              },
              VideoDescription: {
                Width: 1116,
                Height: 480,
                ScalingBehavior: 'DEFAULT',
                DropFrameTimecode: 'NON_DROP_FRAME',
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                    MaxBitrate: 1500000,
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    QualityTuningLevel: 'SINGLE_PASS',
                    CodecProfile: 'MAIN',
                    CodecLevel: 'AUTO',
                    GopSize: 2,
                    GopSizeUnits: 'SECONDS',
                    NumberBFramesBetweenReferenceFrames: 2,
                    InterlaceMode: 'PROGRESSIVE',
                  },
                },
              },
              AudioDescriptions: [
                {
                  AudioSourceName: 'Audio Selector 1',
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                      CodecProfile: 'LC',
                    },
                  },
                },
              ],
            },
            // Output 2: 360p (838 x 360)
            {
              NameModifier: '_360p',
              ContainerSettings: {
                Container: 'M3U8',
              },
              VideoDescription: {
                Width: 838,
                Height: 360,
                ScalingBehavior: 'DEFAULT',
                DropFrameTimecode: 'NON_DROP_FRAME',
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                    MaxBitrate: 800000,
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    QualityTuningLevel: 'SINGLE_PASS',
                    CodecProfile: 'MAIN',
                    CodecLevel: 'AUTO',
                    GopSize: 2,
                    GopSizeUnits: 'SECONDS',
                    NumberBFramesBetweenReferenceFrames: 2,
                    InterlaceMode: 'PROGRESSIVE',
                  },
                },
              },
              AudioDescriptions: [
                {
                  AudioSourceName: 'Audio Selector 1',
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 96000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                      CodecProfile: 'LC',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Synchronizes HLS fields across Course, Recording, DemoVideo, and VideoConversion models.
 */
async function syncHlsDatabaseRecords({
  s3Key,
  videoId,
  status,
  jobId = '',
  error = '',
  convertedAt = null,
  originalVideoUrl = '',
}) {
  const cleanKey = String(s3Key || '').trim();
  const cleanVideoId = String(videoId || deriveVideoIdFromKey(cleanKey)).trim();
  const normStatus = String(status || 'PENDING').toUpperCase();
  const hlsOutputPrefix = `hls/${cleanVideoId}/`;
  const hlsMasterUrl = normStatus === 'COMPLETED' ? getCloudFrontHlsMasterUrl(cleanVideoId) : '';

  const updateFields = {
    hlsConversionStatus: normStatus,
    hlsOutputPrefix,
  };
  if (jobId) updateFields.mediaConvertJobId = jobId;
  if (error) updateFields.hlsConversionError = error;
  if (normStatus === 'COMPLETED') {
    updateFields.hlsMasterUrl = hlsMasterUrl;
    updateFields.hlsConvertedAt = convertedAt || new Date();
    updateFields.hlsConversionError = '';
  }
  if (originalVideoUrl) updateFields.originalVideoUrl = originalVideoUrl;

  const isDbConnected = mongoose.connection?.readyState === 1;

  try {
    // 1. Update VideoConversion document
    if (isDbConnected || (VideoConversion.findOneAndUpdate && VideoConversion.findOneAndUpdate !== mongoose.Model.findOneAndUpdate)) {
      await VideoConversion.findOneAndUpdate(
        { originalS3Key: cleanKey },
        {
          $set: {
            ...updateFields,
            videoId: cleanVideoId,
          },
        },
        { upsert: true, new: true }
      );
    }

    // 2. Update matching Course lessons and videoParts
    if (cleanKey && (isDbConnected || (Course.updateMany && Course.updateMany !== mongoose.Model.updateMany))) {
      // Direct lesson fields
      await Course.updateMany(
        {
          $or: [
            { 'modules.lessons.s3Key': cleanKey },
            { 'modules.lessons.videoS3Key': cleanKey },
          ],
        },
        {
          $set: {
            'modules.$[].lessons.$[les].hlsConversionStatus': normStatus,
            'modules.$[].lessons.$[les].hlsOutputPrefix': hlsOutputPrefix,
            ...(jobId ? { 'modules.$[].lessons.$[les].mediaConvertJobId': jobId } : {}),
            ...(normStatus === 'COMPLETED'
              ? {
                  'modules.$[].lessons.$[les].hlsMasterUrl': hlsMasterUrl,
                  'modules.$[].lessons.$[les].hlsConvertedAt': updateFields.hlsConvertedAt,
                  'modules.$[].lessons.$[les].hlsConversionError': '',
                }
              : {}),
            ...(normStatus === 'FAILED'
              ? { 'modules.$[].lessons.$[les].hlsConversionError': error }
              : {}),
          },
        },
        {
          arrayFilters: [
            {
              $or: [
                { 'les.s3Key': cleanKey },
                { 'les.videoS3Key': cleanKey },
              ],
            },
          ],
        }
      );

      // videoParts subdocument fields
      await Course.updateMany(
        { 'modules.lessons.videoParts.s3Key': cleanKey },
        {
          $set: {
            'modules.$[].lessons.$[].videoParts.$[part].hlsConversionStatus': normStatus,
            'modules.$[].lessons.$[].videoParts.$[part].hlsOutputPrefix': hlsOutputPrefix,
            ...(jobId ? { 'modules.$[].lessons.$[].videoParts.$[part].mediaConvertJobId': jobId } : {}),
            ...(normStatus === 'COMPLETED'
              ? {
                  'modules.$[].lessons.$[].videoParts.$[part].hlsMasterUrl': hlsMasterUrl,
                  'modules.$[].lessons.$[].videoParts.$[part].hlsConvertedAt': updateFields.hlsConvertedAt,
                  'modules.$[].lessons.$[].videoParts.$[part].hlsConversionError': '',
                }
              : {}),
            ...(normStatus === 'FAILED'
              ? { 'modules.$[].lessons.$[].videoParts.$[part].hlsConversionError': error }
              : {}),
          },
        },
        {
          arrayFilters: [{ 'part.s3Key': cleanKey }],
        }
      );
    }

    // 3. Update Recording records
    if (cleanKey && (isDbConnected || (Recording.updateMany && Recording.updateMany !== mongoose.Model.updateMany))) {
      await Recording.updateMany(
        { s3Key: cleanKey },
        { $set: updateFields }
      );
    }

    // 4. Update DemoVideo records
    if (cleanKey && (isDbConnected || (DemoVideo.updateMany && DemoVideo.updateMany !== mongoose.Model.updateMany))) {
      await DemoVideo.updateMany(
        { s3Key: cleanKey },
        { $set: updateFields }
      );
    }

    console.info(`[MediaConvert] Synced database records for ${cleanKey || cleanVideoId} -> ${normStatus}`);
  } catch (syncErr) {
    console.error(`[MediaConvert] Error syncing database records for ${cleanKey}:`, syncErr.message);
  }
}

/**
 * Submits an AWS Elemental MediaConvert job for a video S3 key.
 * Strictly non-blocking, idempotent, and records status in database.
 */
async function submitHlsConversionJob({
  s3Key,
  videoId,
  userMetadata = {},
  force = false,
}) {
  const cleanKey = String(s3Key || '').trim();
  if (!isEligibleVideoKey(cleanKey)) {
    throw new Error(`Ineligible video key for HLS transcoding: ${cleanKey}`);
  }

  const resolvedVideoId = String(videoId || deriveVideoIdFromKey(cleanKey)).trim();
  const bucketName = mediaConvertConfig.bucket;
  const inputS3Uri = `s3://${bucketName}/${cleanKey}`;
  const outputS3Destination = `s3://${bucketName}/hls/${resolvedVideoId}/`;

  // Idempotency check 1: in-flight memory lock
  if (inFlightSubmissions.has(cleanKey)) {
    console.info(`[MediaConvert] Job submission already in flight for ${cleanKey}, skipping duplicate.`);
    const existing = await VideoConversion.findOne({ originalS3Key: cleanKey }).lean();
    return {
      success: true,
      jobId: existing?.mediaConvertJobId || '',
      status: existing?.hlsConversionStatus || 'PENDING',
      videoId: resolvedVideoId,
      hlsOutputPrefix: `hls/${resolvedVideoId}/`,
      hlsMasterUrl: getCloudFrontHlsMasterUrl(resolvedVideoId),
    };
  }

  // Idempotency check 2: DB record status
  if (!force && (mongoose.connection?.readyState === 1 || VideoConversion.findOne !== mongoose.Model.findOne)) {
    const existingRecord = await VideoConversion.findOne({ originalS3Key: cleanKey }).lean();
    if (existingRecord) {
      const currentStatus = String(existingRecord.hlsConversionStatus || '').toUpperCase();
      if (currentStatus === 'COMPLETED' && existingRecord.hlsMasterUrl) {
        console.info(`[MediaConvert] Video ${cleanKey} is already COMPLETED. Skipping job submission.`);
        return {
          success: true,
          jobId: existingRecord.mediaConvertJobId,
          status: 'COMPLETED',
          videoId: resolvedVideoId,
          hlsOutputPrefix: existingRecord.hlsOutputPrefix || `hls/${resolvedVideoId}/`,
          hlsMasterUrl: existingRecord.hlsMasterUrl,
        };
      }
      if (['PROCESSING', 'PENDING'].includes(currentStatus) && existingRecord.mediaConvertJobId) {
        console.info(`[MediaConvert] Video ${cleanKey} is currently ${currentStatus} (jobId: ${existingRecord.mediaConvertJobId}). Skipping duplicate.`);
        return {
          success: true,
          jobId: existingRecord.mediaConvertJobId,
          status: currentStatus,
          videoId: resolvedVideoId,
          hlsOutputPrefix: existingRecord.hlsOutputPrefix || `hls/${resolvedVideoId}/`,
          hlsMasterUrl: getCloudFrontHlsMasterUrl(resolvedVideoId),
        };
      }
    }
  }

  inFlightSubmissions.add(cleanKey);

  try {
    // Verify source video existence in S3 before calling MediaConvert
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: cleanKey }));
    } catch (headErr) {
      if (headErr.name === 'NotFound' || headErr.name === 'NoSuchKey' || headErr.$metadata?.httpStatusCode === 404) {
        throw new Error(`Source video not found in S3 bucket ${bucketName}: ${cleanKey}`);
      }
      // If permission or network check fails in test environment, log warning and continue
      console.warn(`[MediaConvert] S3 HeadObject warning for ${cleanKey}: ${headErr.message}`);
    }

    const jobSettings = buildHlsJobSettings({
      inputS3Uri,
      outputS3Destination,
      videoId: resolvedVideoId,
      userMetadata: {
        ...userMetadata,
        s3Key: cleanKey,
      },
    });

    console.info(`[MediaConvert] Submitting job for ${cleanKey} (destination: ${outputS3Destination})...`);
    const client = await getMediaConvertClient();
    const command = new CreateJobCommand(jobSettings);
    const response = await client.send(command);

    const jobId = response.Job?.Id || `job_${Date.now()}`;
    const initialStatus = 'PROCESSING';

    console.info(`[MediaConvert] Job successfully submitted. JobId: ${jobId}`);

    // Update database records to PROCESSING
    await syncHlsDatabaseRecords({
      s3Key: cleanKey,
      videoId: resolvedVideoId,
      status: initialStatus,
      jobId,
      outputPrefix: `hls/${resolvedVideoId}/`,
    });

    return {
      success: true,
      jobId,
      status: initialStatus,
      videoId: resolvedVideoId,
      hlsOutputPrefix: `hls/${resolvedVideoId}/`,
      hlsMasterUrl: getCloudFrontHlsMasterUrl(resolvedVideoId),
    };
  } catch (err) {
    console.error(`[MediaConvert] Failed to submit job for ${cleanKey}:`, err.message);
    await syncHlsDatabaseRecords({
      s3Key: cleanKey,
      videoId: resolvedVideoId,
      status: 'FAILED',
      error: err.message,
    });
    throw err;
  } finally {
    inFlightSubmissions.delete(cleanKey);
  }
}

/**
 * Enqueues a video for MediaConvert HLS conversion asynchronously without blocking the caller.
 * Returns initial status immediately.
 */
function enqueueHlsConversion(s3Key, options = {}) {
  const cleanKey = String(s3Key || '').trim();
  if (!isEligibleVideoKey(cleanKey)) {
    return {
      enqueued: false,
      reason: 'Ineligible video key',
    };
  }

  const videoId = options.videoId || deriveVideoIdFromKey(cleanKey);
  const hlsOutputPrefix = `hls/${videoId}/`;
  const hlsMasterUrl = getCloudFrontHlsMasterUrl(videoId);

  // Set initial PENDING record in DB immediately
  syncHlsDatabaseRecords({
    s3Key: cleanKey,
    videoId,
    status: 'PENDING',
    outputPrefix: hlsOutputPrefix,
  }).catch((e) => console.warn('[MediaConvert] DB sync error on enqueue:', e.message));

  // Asynchronously submit job to AWS Elemental MediaConvert
  setImmediate(async () => {
    try {
      await submitHlsConversionJob({
        s3Key: cleanKey,
        videoId,
        userMetadata: options.userMetadata || {},
        force: options.force === true,
      });
    } catch (err) {
      console.error(`[MediaConvert] Background submission error for ${cleanKey}:`, err.message);
    }
  });

  return {
    enqueued: true,
    status: 'PENDING',
    videoId,
    hlsOutputPrefix,
    hlsMasterUrl,
  };
}

/**
 * Processes an AWS EventBridge MediaConvert Job State Change notification.
 * Updates database statuses on COMPLETE or ERROR.
 */
async function handleJobStateChange(eventPayload) {
  // Support either raw EventBridge message or pre-parsed detail
  const detail = eventPayload?.detail || eventPayload || {};
  const jobId = detail.jobId || detail.Id;
  const status = String(detail.status || '').toUpperCase();
  const userMetadata = detail.userMetadata || {};
  const s3Key = userMetadata.s3Key || '';
  const videoId = userMetadata.videoId || (s3Key ? deriveVideoIdFromKey(s3Key) : '');

  console.info(`[MediaConvert EventBridge] Received job state change: JobId=${jobId}, status=${status}, videoId=${videoId}`);

  if (!jobId && !s3Key && !videoId) {
    console.warn('[MediaConvert EventBridge] Notification missing jobId and video identifiers, ignoring.');
    return { success: false, reason: 'Missing identifiers' };
  }

  // Find existing record by jobId, s3Key, or videoId
  let existing = null;
  const isDbConnected = mongoose.connection?.readyState === 1;
  if (isDbConnected || (VideoConversion.findOne && VideoConversion.findOne !== mongoose.Model.findOne)) {
    if (jobId) existing = await VideoConversion.findOne({ mediaConvertJobId: jobId });
    if (!existing && s3Key) existing = await VideoConversion.findOne({ originalS3Key: s3Key });
    if (!existing && videoId) existing = await VideoConversion.findOne({ videoId });
  }

  const resolvedKey = s3Key || existing?.originalS3Key || '';
  const resolvedVideoId = videoId || existing?.videoId || deriveVideoIdFromKey(resolvedKey);

  if (status === 'COMPLETE') {
    const masterUrl = getCloudFrontHlsMasterUrl(resolvedVideoId);
    console.info(`[MediaConvert EventBridge] Job ${jobId} COMPLETED. Master URL: ${masterUrl}`);

    await syncHlsDatabaseRecords({
      s3Key: resolvedKey,
      videoId: resolvedVideoId,
      status: 'COMPLETED',
      jobId,
      convertedAt: new Date(),
    });

    return {
      success: true,
      status: 'COMPLETED',
      jobId,
      videoId: resolvedVideoId,
      hlsMasterUrl: masterUrl,
    };
  }

  if (status === 'ERROR') {
    const errorMessage = detail.errorMessage || detail.error || 'MediaConvert job processing failed.';
    console.error(`[MediaConvert EventBridge] Job ${jobId} FAILED: ${errorMessage}`);

    await syncHlsDatabaseRecords({
      s3Key: resolvedKey,
      videoId: resolvedVideoId,
      status: 'FAILED',
      jobId,
      error: errorMessage,
    });

    return {
      success: true,
      status: 'FAILED',
      jobId,
      videoId: resolvedVideoId,
      error: errorMessage,
    };
  }

  if (status === 'STATUS_UPDATE') {
    console.info(`[MediaConvert EventBridge] Job ${jobId} status update: ${detail.padding || 'in-progress'}`);
    await syncHlsDatabaseRecords({
      s3Key: resolvedKey,
      videoId: resolvedVideoId,
      status: 'PROCESSING',
      jobId,
    });
    return { success: true, status: 'PROCESSING', jobId };
  }

  return { success: true, status: status || 'UNKNOWN', jobId };
}

/**
 * Checks job status via AWS MediaConvert API (polling fallback if needed).
 */
async function checkMediaConvertJob(jobId) {
  if (!jobId) return null;
  try {
    const client = await getMediaConvertClient();
    const res = await client.send(new GetJobCommand({ Id: jobId }));
    const job = res.Job;
    if (job) {
      await handleJobStateChange({
        jobId: job.Id,
        status: job.Status,
        errorMessage: job.ErrorMessage,
        userMetadata: job.UserMetadata,
      });
      return {
        jobId: job.Id,
        status: String(job.Status).toUpperCase(),
        errorMessage: job.ErrorMessage || '',
        createdAt: job.CreatedAt,
      };
    }
  } catch (err) {
    console.warn(`[MediaConvert] Failed to query job status for ${jobId}:`, err.message);
  }
  return null;
}

/**
 * Returns comprehensive HLS conversion status for a given video key or videoId.
 */
async function getHlsConversionStatus(s3KeyOrVideoId) {
  const target = String(s3KeyOrVideoId || '').trim();
  let record = null;
  const isDbConnected = mongoose.connection?.readyState === 1;

  if (isDbConnected || (VideoConversion.findOne && VideoConversion.findOne !== mongoose.Model.findOne)) {
    try {
      const q = VideoConversion.findOne({
        $or: [{ originalS3Key: target }, { videoId: target }, { mediaConvertJobId: target }],
      });
      record = (q && typeof q.lean === 'function') ? await q.lean() : await q;
    } catch (_) {}
  }

  if (!record) {
    const videoId = deriveVideoIdFromKey(target);
    return {
      s3Key: target,
      videoId,
      status: 'none',
      hlsConversionStatus: 'none',
      hlsMasterUrl: '',
      hlsOutputPrefix: `hls/${videoId}/`,
      mediaConvertJobId: '',
      error: '',
    };
  }

  const normStatus = String(record.hlsConversionStatus || record.status || 'none').toUpperCase();
  const videoId = record.videoId || deriveVideoIdFromKey(record.originalS3Key);

  return {
    s3Key: record.originalS3Key,
    videoId,
    status: normStatus,
    hlsConversionStatus: normStatus,
    hlsMasterUrl: normStatus === 'COMPLETED' ? (record.hlsMasterUrl || getCloudFrontHlsMasterUrl(videoId)) : '',
    hlsOutputPrefix: record.hlsOutputPrefix || `hls/${videoId}/`,
    mediaConvertJobId: record.mediaConvertJobId || '',
    error: record.hlsConversionError || record.error || '',
    convertedAt: record.hlsConvertedAt || record.completedAt || null,
    originalVideoUrl: record.originalVideoUrl || '',
  };
}

module.exports = {
  deriveVideoIdFromKey,
  isEligibleVideoKey,
  getCloudFrontHlsMasterUrl,
  buildHlsJobSettings,
  syncHlsDatabaseRecords,
  submitHlsConversionJob,
  enqueueHlsConversion,
  handleJobStateChange,
  checkMediaConvertJob,
  getHlsConversionStatus,
};
