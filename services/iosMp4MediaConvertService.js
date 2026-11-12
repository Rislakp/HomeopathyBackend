/**
 * Builds the 720p seek-safe iOS MP4 (`<original>_ios.mp4`) with AWS MediaConvert.
 *
 * Same rules as the ffmpeg path, which iOS Safari needs to seek without freezing:
 * keyframe every 2 seconds (closed GOP), constant 30 fps, H.264 Main, AAC 48 kHz,
 * and the moov atom at the start of the file (faststart).
 *
 * MediaConvert runs many jobs in parallel, so this is the way to convert a large
 * library quickly without loading the API server.
 */
const path = require('path');
const { CreateJobCommand, GetJobCommand } = require('@aws-sdk/client-mediaconvert');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/s3');
const { mediaConvertConfig, getMediaConvertClient } = require('../config/mediaconvert');
const VideoConversion = require('../models/VideoConversion');
const {
  IOS_MP4_MEDIACONVERT_PROFILE,
  getM4vKeyForOriginal,
  isConvertibleVideoKey,
  syncDatabaseRecords,
} = require('./videoConversionService');

const JOB_TYPE = 'ios-mp4';

function buildIosMp4JobSettings({ s3Key, targetKey, bucketName = mediaConvertConfig.bucket }) {
  // MediaConvert names the output <input name><NameModifier>.<Extension>,
  // so writing to the original's folder gives exactly `<original>_ios.mp4`.
  const folder = path.posix.dirname(s3Key);
  return {
    Role: mediaConvertConfig.roleArn,
    UserMetadata: {
      jobType: JOB_TYPE,
      s3Key,
      targetKey,
    },
    Settings: {
      TimecodeConfig: { Source: 'ZEROBASED' },
      Inputs: [
        {
          AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
          VideoSelector: {},
          TimecodeSource: 'ZEROBASED',
          FileInput: `s3://${bucketName}/${s3Key}`,
        },
      ],
      OutputGroups: [
        {
          Name: 'File Group',
          CustomName: 'iOS MP4 720p',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: { Destination: `s3://${bucketName}/${folder}/` },
          },
          Outputs: [
            {
              NameModifier: '_ios',
              Extension: 'mp4',
              ContainerSettings: {
                Container: 'MP4',
                Mp4Settings: {
                  MoovPlacement: 'PROGRESSIVE_DOWNLOAD', // faststart
                  CslgAtom: 'INCLUDE',
                  FreeSpaceBox: 'EXCLUDE',
                },
              },
              VideoDescription: {
                // Height only: width follows the source aspect ratio (1920x1080 -> 1280x720).
                Height: 720,
                ScalingBehavior: 'DEFAULT',
                AntiAlias: 'ENABLED',
                Sharpness: 50,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    MaxBitrate: 3000000,
                    QualityTuningLevel: 'SINGLE_PASS',
                    CodecProfile: 'MAIN',
                    CodecLevel: 'AUTO',
                    GopSize: 2,
                    GopSizeUnits: 'SECONDS',
                    GopClosedCadence: 1,
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    NumberBFramesBetweenReferenceFrames: 2,
                    InterlaceMode: 'PROGRESSIVE',
                    FramerateControl: 'SPECIFIED',
                    FramerateNumerator: 30,
                    FramerateDenominator: 1,
                    FramerateConversionAlgorithm: 'DUPLICATE_DROP',
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
          ],
        },
      ],
    },
  };
}

/**
 * Submits a MediaConvert job for one original video.
 * Skips videos that already have a 720p seek-safe MP4, or a job still running.
 * Returns { s3Key, targetKey, jobId, state } where state is 'submitted', 'running' or 'done'.
 */
async function submitIosMp4Job(s3Key, { force = false } = {}) {
  const cleanKey = String(s3Key || '').trim();
  if (!isConvertibleVideoKey(cleanKey)) {
    throw new Error(`Not a convertible original video key: ${cleanKey}`);
  }
  const targetKey = getM4vKeyForOriginal(cleanKey);
  const record = await VideoConversion.findOne({ originalS3Key: cleanKey }).lean();

  if (!force && record) {
    if (record.encodeProfile === IOS_MP4_MEDIACONVERT_PROFILE && record.status === 'completed' && record.m4vS3Key === targetKey) {
      return { s3Key: cleanKey, targetKey, jobId: record.iosMp4JobId || '', state: 'done' };
    }
    if (record.iosMp4JobId && record.status === 'processing') {
      return { s3Key: cleanKey, targetKey, jobId: record.iosMp4JobId, state: 'running' };
    }
  }

  const client = await getMediaConvertClient();
  const res = await client.send(new CreateJobCommand(buildIosMp4JobSettings({ s3Key: cleanKey, targetKey })));
  const jobId = res?.Job?.Id;
  if (!jobId) throw new Error('MediaConvert did not return a job id');

  await VideoConversion.findOneAndUpdate(
    { originalS3Key: cleanKey },
    {
      $set: { iosMp4JobId: jobId, status: 'processing', lastAttemptAt: new Date(), error: '' },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true }
  );
  await syncDatabaseRecords(cleanKey, targetKey, 'processing');
  return { s3Key: cleanKey, targetKey, jobId, state: 'submitted' };
}

/**
 * Applies a finished job to the database. Used by the polling script and the
 * MediaConvert webhook (handleJobStateChange forwards jobs tagged jobType=ios-mp4).
 */
async function handleIosMp4JobState({ jobId, status, errorMessage, userMetadata = {} }) {
  const s3Key = String(userMetadata.s3Key || '').trim();
  const targetKey = String(userMetadata.targetKey || getM4vKeyForOriginal(s3Key)).trim();
  const upper = String(status || '').toUpperCase();
  if (!s3Key) return { success: false, reason: 'missing s3Key' };

  if (upper === 'COMPLETE') {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: mediaConvertConfig.bucket, Key: targetKey }));
    if (!(Number(head?.ContentLength) > 0)) {
      throw new Error(`MediaConvert job ${jobId} finished but ${targetKey} is missing or empty`);
    }
    await VideoConversion.findOneAndUpdate(
      { originalS3Key: s3Key },
      {
        $set: {
          m4vS3Key: targetKey,
          encodeProfile: IOS_MP4_MEDIACONVERT_PROFILE,
          iosMp4JobId: jobId,
          status: 'completed',
          fileSize: Number(head.ContentLength),
          completedAt: new Date(),
          error: '',
        },
      },
      { upsert: true, new: true }
    );
    await syncDatabaseRecords(s3Key, targetKey, 'completed');
    return { success: true, status: 'completed', s3Key, targetKey };
  }

  if (upper === 'ERROR' || upper === 'CANCELED') {
    const error = errorMessage || `MediaConvert job ${upper.toLowerCase()}`;
    await VideoConversion.findOneAndUpdate(
      { originalS3Key: s3Key },
      { $set: { status: 'failed', error } },
      { upsert: true, new: true }
    );
    await syncDatabaseRecords(s3Key, targetKey, 'failed', error);
    return { success: true, status: 'failed', s3Key, error };
  }

  return { success: true, status: 'processing', s3Key };
}

/** Reads a job from MediaConvert and applies it if it has finished. */
async function checkIosMp4Job(jobId) {
  const client = await getMediaConvertClient();
  const res = await client.send(new GetJobCommand({ Id: jobId }));
  const job = res?.Job;
  if (!job) throw new Error(`MediaConvert job ${jobId} not found`);
  const result = await handleIosMp4JobState({
    jobId: job.Id,
    status: job.Status,
    errorMessage: job.ErrorMessage,
    userMetadata: job.UserMetadata || {},
  });
  return { ...result, mediaConvertStatus: String(job.Status || '').toUpperCase() };
}

/**
 * Starts the iOS rendition for a video with the configured engine.
 * IOS_RENDITION_ENGINE=mediaconvert (default) uses MediaConvert; =ffmpeg uses the
 * on-server ffmpeg queue. Never throws: failures are logged and stored on the record.
 */
function startIosRendition(s3Key, options = {}) {
  const engine = String(process.env.IOS_RENDITION_ENGINE || 'mediaconvert').trim().toLowerCase();
  if (engine === 'ffmpeg') {
    const { enqueueConversion } = require('./videoConversionService');
    return enqueueConversion(s3Key, options);
  }
  if (!isConvertibleVideoKey(String(s3Key || '').trim())) return false;
  submitIosMp4Job(s3Key, options)
    .then((r) => console.info(`[iOS MP4] ${r.state}: ${r.s3Key} -> ${r.targetKey} (job ${r.jobId || '-'})`))
    .catch((err) => console.error(`[iOS MP4] Could not submit MediaConvert job for ${s3Key}:`, err.message));
  return true;
}

module.exports = {
  JOB_TYPE,
  startIosRendition,
  buildIosMp4JobSettings,
  submitIosMp4Job,
  handleIosMp4JobState,
  checkIosMp4Job,
};
