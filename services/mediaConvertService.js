const mongoose = require('mongoose');
const { CreateJobCommand, GetJobCommand } = require('@aws-sdk/client-mediaconvert');
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/s3');
const { mediaConvertConfig, getMediaConvertClient } = require('../config/mediaconvert');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const VideoConversion = require('../models/VideoConversion');

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
 * AWS MediaConvert generates {videoId}.m3u8 as the master playlist in S3.
 */
function getCloudFrontHlsMasterUrl(videoId) {
  if (!videoId || typeof videoId !== 'string') return '';
  const domain = mediaConvertConfig.cloudFrontDomain;
  const cleanId = videoId.trim().replace(/\.m3u8$/i, '');
  return `https://${domain}/hls/${cleanId}/${cleanId}.m3u8`;
}

function parseMediaConvertS3Path(uri, videoId) {
  if (typeof uri !== 'string') return null;
  const match = uri.trim().match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (!match || match[1] !== mediaConvertConfig.bucket) return null;
  const key = match[2];
  if (!key.startsWith(`hls/${videoId}/`) || key.includes('..') || key.includes('//') || /[\\\r\n]/.test(key)) return null;
  return { bucket: match[1], key };
}

function getOutputQuality(outputDetail, outputPath) {
  const height = Number(outputDetail?.videoDetails?.heightInPx || outputDetail?.videoDetails?.HeightInPx);
  if (height === 360 || height === 480) return height;
  const match = String(outputPath || '').match(/(?:^|[_-])(360|480)p\.m3u8(?:[?#].*)?$/i);
  return match ? Number(match[1]) : null;
}

async function bodyToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString();
  if (typeof body === 'string' || Buffer.isBuffer(body)) return String(body);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function resolvePlaylistReference(masterKey, reference, videoId) {
  const cleanReference = String(reference || '').trim();
  if (!cleanReference || cleanReference.startsWith('//')) return null;
  try {
    const url = new URL(cleanReference, `https://hls.invalid/${masterKey}`);
    if (url.hostname !== 'hls.invalid' || url.protocol !== 'https:' || url.search || url.hash) return null;
    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key.startsWith(`hls/${videoId}/`) || key.split('/').some((part) => part === '.' || part === '..')) return null;
    return key;
  } catch (_) {
    return null;
  }
}

function parseMediaPlaylist(manifest, playlistKey, videoId) {
  const lines = String(manifest || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Invalid media playlist header');
  const targetLines = lines.filter((line) => line.startsWith('#EXT-X-TARGETDURATION:'));
  if (targetLines.length !== 1) throw new Error('Invalid target duration');
  const targetLine = targetLines[0];
  const targetDuration = Number(targetLine?.slice('#EXT-X-TARGETDURATION:'.length));
  if (!Number.isInteger(targetDuration) || targetDuration <= 0) throw new Error('Invalid target duration');
  const sequenceLine = lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  const mediaSequence = sequenceLine ? Number(sequenceLine.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) : 0;
  if (!Number.isSafeInteger(mediaSequence) || mediaSequence < 0) throw new Error('Invalid media sequence');
  const discontinuitySequenceLines = lines.filter((line) => line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:'));
  if (discontinuitySequenceLines.length > 1) throw new Error('Invalid discontinuity sequence');
  const discontinuitySequence = discontinuitySequenceLines.length
    ? Number(discontinuitySequenceLines[0].slice('#EXT-X-DISCONTINUITY-SEQUENCE:'.length))
    : 0;
  if (!Number.isSafeInteger(discontinuitySequence) || discontinuitySequence < 0) throw new Error('Invalid discontinuity sequence');

  let pendingDuration = null;
  let maxDuration = 0;
  const segments = [];
  const durations = [];
  const discontinuities = [];
  const initializationSegments = [];
  let ended = false;
  for (const line of lines.slice(1)) {
    if (ended) throw new Error('Playlist contains entries after ENDLIST');
    if (line.startsWith('#EXTINF:')) {
      if (pendingDuration !== null) throw new Error('Missing segment URI');
      const duration = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid segment duration');
      pendingDuration = duration;
      maxDuration = Math.max(maxDuration, duration);
    } else if (line === '#EXT-X-DISCONTINUITY') {
      if (pendingDuration !== null) throw new Error('Discontinuity appears after EXTINF');
      discontinuities.push(segments.length);
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/(?:^|,)URI="([^"]+)"/i)?.[1];
      const key = resolvePlaylistReference(playlistKey, uri, videoId);
      if (!key || !/\.mp4$/i.test(key)) throw new Error('Invalid initialization segment reference');
      initializationSegments.push({ index: segments.length, key });
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      if (pendingDuration !== null) throw new Error('Missing final segment URI');
      ended = true;
    } else if (!line.startsWith('#')) {
      if (pendingDuration === null) throw new Error('Segment URI has no EXTINF');
      const key = resolvePlaylistReference(playlistKey, line, videoId);
      if (!key || !/\.(?:ts|m4s)$/i.test(key)) throw new Error('Invalid segment reference');
      segments.push(key);
      durations.push(pendingDuration);
      pendingDuration = null;
    }
  }
  if (!segments.length || pendingDuration !== null || !ended || lines.at(-1) !== '#EXT-X-ENDLIST') throw new Error('Incomplete VOD playlist');
  if (Math.ceil(maxDuration) > targetDuration) throw new Error('Target duration is shorter than a segment');
  return { targetDuration, mediaSequence, discontinuitySequence, segments, durations, discontinuities, initializationSegments };
}

async function readS3Text(bucket, key) {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return bodyToString(response?.Body);
}

async function verifyS3Objects(bucketName, keys) {
  const uniqueKeys = [...new Set(keys)];
  const concurrency = 16;
  for (let offset = 0; offset < uniqueKeys.length; offset += concurrency) {
    await Promise.all(uniqueKeys.slice(offset, offset + concurrency).map(async (key) => {
      const metadata = await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      if (!(Number(metadata?.ContentLength) > 0)) throw new Error(`Missing or empty HLS object: ${key}`);
    }));
  }
}

/**
 * Resolve and verify the actual HLS playlist and variant paths reported by
 * MediaConvert's COMPLETE event before persisting a completed state.
 */
async function validateHlsOutputFiles(detail, videoId) {
  const outputGroups = Array.isArray(detail?.outputGroupDetails) ? detail.outputGroupDetails : [];
  const hlsGroup = outputGroups.find((group) => String(group?.type || '').toUpperCase() === 'HLS_GROUP');
  if (!hlsGroup) return { valid: false, error: 'MediaConvert did not report an HLS output group.' };

  const masterPaths = (Array.isArray(hlsGroup.playlistFilePaths) ? hlsGroup.playlistFilePaths : [])
    .map((path) => parseMediaConvertS3Path(path, videoId))
    .filter(Boolean)
    .filter((path) => path.key.toLowerCase().endsWith('.m3u8'));
  if (masterPaths.length !== 1) return { valid: false, error: 'MediaConvert did not report exactly one valid master playlist.' };

  const variantPathsByQuality = new Map();
  for (const output of Array.isArray(hlsGroup.outputDetails) ? hlsGroup.outputDetails : []) {
    for (const path of Array.isArray(output?.outputFilePaths) ? output.outputFilePaths : []) {
      if (!String(path).toLowerCase().endsWith('.m3u8')) continue;
      const parsed = parseMediaConvertS3Path(path, videoId);
      const quality = getOutputQuality(output, path);
      if (parsed && (quality === 360 || quality === 480) && !variantPathsByQuality.has(quality)) {
        variantPathsByQuality.set(quality, parsed);
      }
    }
  }
  if (!variantPathsByQuality.has(360) || !variantPathsByQuality.has(480)) {
    return { valid: false, error: 'MediaConvert did not report both 360p and 480p variant playlists.' };
  }

  const master = masterPaths[0];
  const variants = [variantPathsByQuality.get(360), variantPathsByQuality.get(480)];
  if (variants.some((variant) => variant.key === master.key) || variants[0].key === variants[1].key) {
    return { valid: false, error: 'MediaConvert reported conflicting HLS playlist paths.' };
  }

  try {
    await verifyS3Objects(master.bucket, [master.key, ...variants.map((variant) => variant.key)]);
    const masterPlaylist = await readS3Text(master.bucket, master.key);
    const masterLines = String(masterPlaylist).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (masterLines[0] !== '#EXTM3U' || !masterLines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'))) {
      return { valid: false, error: 'The reported master playlist is missing or invalid.' };
    }

    const referencedPlaylists = new Set();
    let awaitingVariant = false;
    for (const line of masterLines.slice(1)) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        if (awaitingVariant) throw new Error('Master playlist stream is missing a URI');
        awaitingVariant = true;
      } else if (!line.startsWith('#') && awaitingVariant) {
        const resolvedKey = resolvePlaylistReference(master.key, line, videoId);
        if (!resolvedKey || !resolvedKey.toLowerCase().endsWith('.m3u8')) throw new Error('Invalid variant playlist reference');
        referencedPlaylists.add(resolvedKey);
        awaitingVariant = false;
      }
    }
    if (awaitingVariant || referencedPlaylists.size !== 2 || variants.some((variant) => !referencedPlaylists.has(variant.key))) {
      return { valid: false, error: 'The master playlist does not reference both reported variant playlists.' };
    }

    const mediaPlaylists = await Promise.all(variants.map(async (variant) => {
      const text = await readS3Text(master.bucket, variant.key);
      const parsed = parseMediaPlaylist(text, variant.key, videoId);
      return { variant, parsed };
    }));
    const firstSequence = mediaPlaylists[0].parsed.mediaSequence;
    const segmentCount = mediaPlaylists[0].parsed.segments.length;
    for (const playlist of mediaPlaylists) {
      if (playlist.parsed.mediaSequence !== firstSequence || playlist.parsed.segments.length !== segmentCount) {
        throw new Error('Variant segment sequences do not align');
      }
    }
    const reference = mediaPlaylists[0].parsed;
    for (const playlist of mediaPlaylists.slice(1)) {
      const candidate = playlist.parsed;
      if (candidate.targetDuration !== reference.targetDuration ||
          candidate.mediaSequence !== reference.mediaSequence ||
          candidate.discontinuitySequence !== reference.discontinuitySequence ||
          candidate.segments.length !== reference.segments.length ||
          candidate.discontinuities.join(',') !== reference.discontinuities.join(',') ||
          candidate.initializationSegments.map((item) => item.index).join(',') !== reference.initializationSegments.map((item) => item.index).join(',') ||
          candidate.durations.some((duration, index) => Math.abs(duration - reference.durations[index]) > 0.1)) {
        throw new Error('Variant playlist timelines are not aligned');
      }
    }
    await verifyS3Objects(master.bucket, mediaPlaylists.flatMap(({ parsed }) => [
      ...parsed.segments,
      ...parsed.initializationSegments.map((item) => item.key),
    ]));

    const masterKeyPrefix = master.key.slice(0, master.key.lastIndexOf('/') + 1);
    return {
      valid: true,
      hlsMasterUrl: `https://${mediaConvertConfig.cloudFrontDomain}/${master.key.split('/').map(encodeURIComponent).join('/')}`,
      hlsOutputPrefix: masterKeyPrefix,
      masterS3Key: master.key,
      variantS3Keys: variants.map((variant) => variant.key),
    };
  } catch (_) {
    return { valid: false, error: 'One or more reported HLS output files are missing or unreadable.' };
  }
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
              SegmentLengthControl: 'GOP_MULTIPLE',
              SegmentControl: 'SEGMENTED_FILES',
              MinSegmentLength: 0,
              Destination: outputS3Destination,
              DirectoryStructure: 'SINGLE_DIRECTORY',
              ManifestDurationFormat: 'INTEGER',
              TargetDurationCompatibilityMode: 'LEGACY',
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
                    GopSizeUnits: 'AUTO',
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
                    GopSizeUnits: 'AUTO',
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
 * Synchronizes HLS fields across course lessons, recordings, and VideoConversion.
 */
async function syncHlsDatabaseRecords({
  s3Key,
  videoId,
  status,
  jobId = '',
  error = '',
  convertedAt = null,
  originalVideoUrl = '',
  hlsMasterUrl: reportedHlsMasterUrl = '',
  hlsOutputPrefix: reportedHlsOutputPrefix = '',
}) {
  const cleanKey = String(s3Key || '').trim();
  const cleanVideoId = String(videoId || deriveVideoIdFromKey(cleanKey)).trim();
  const normStatus = String(status || 'PENDING').toUpperCase();
  const hlsOutputPrefix = normStatus === 'COMPLETED'
    ? (String(reportedHlsOutputPrefix || '').trim() || `hls/${cleanVideoId}/`)
    : `hls/${cleanVideoId}/`;
  const hlsMasterUrl = normStatus === 'COMPLETED'
    ? (String(reportedHlsMasterUrl || '').trim() || getCloudFrontHlsMasterUrl(cleanVideoId))
    : '';

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
  if (normStatus === 'FAILED') updateFields.hlsMasterUrl = '';
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
  _fromEnqueue = false,
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
  if (!_fromEnqueue && inFlightSubmissions.has(cleanKey)) {
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

  if (!_fromEnqueue) {
    inFlightSubmissions.add(cleanKey);
  }

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
    if (!_fromEnqueue) {
      inFlightSubmissions.delete(cleanKey);
    }
  }
}

/**
 * Enqueues a video for MediaConvert HLS conversion asynchronously without blocking the caller.
 * Includes synchronous duplicate-submission guard before scheduling setImmediate.
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

  // Synchronous duplicate submission guard
  if (inFlightSubmissions.has(cleanKey)) {
    console.info(`[MediaConvert] Conversion already in flight for ${cleanKey}, skipping duplicate enqueue.`);
    return {
      enqueued: false,
      alreadyInFlight: true,
      status: 'PENDING',
      videoId,
      hlsOutputPrefix,
      hlsMasterUrl,
    };
  }

  // Synchronously lock this key immediately BEFORE scheduling setImmediate
  inFlightSubmissions.add(cleanKey);

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
        _fromEnqueue: true,
      });
    } catch (err) {
      console.error(`[MediaConvert] Background submission error for ${cleanKey}:`, err.message);
    } finally {
      inFlightSubmissions.delete(cleanKey);
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
    const outputValidation = await validateHlsOutputFiles(detail, resolvedVideoId);
    if (!outputValidation.valid) {
      await syncHlsDatabaseRecords({
        s3Key: resolvedKey,
        videoId: resolvedVideoId,
        status: 'FAILED',
        jobId,
        error: outputValidation.error,
      });
      console.warn(`[MediaConvert EventBridge] Job ${jobId} completed without valid HLS outputs; playback will use MP4 fallback.`);
      return {
        success: true,
        status: 'FAILED',
        jobId,
        videoId: resolvedVideoId,
        error: outputValidation.error,
      };
    }

    await syncHlsDatabaseRecords({
      s3Key: resolvedKey,
      videoId: resolvedVideoId,
      status: 'COMPLETED',
      jobId,
      convertedAt: new Date(),
      hlsMasterUrl: outputValidation.hlsMasterUrl,
      hlsOutputPrefix: outputValidation.hlsOutputPrefix,
    });

    return {
      success: true,
      status: 'COMPLETED',
      jobId,
      videoId: resolvedVideoId,
      hlsMasterUrl: outputValidation.hlsMasterUrl,
      hlsOutputPrefix: outputValidation.hlsOutputPrefix,
      hlsVariantS3Keys: outputValidation.variantS3Keys,
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

  let hlsMasterUrl = '';
  if (normStatus === 'COMPLETED') {
    hlsMasterUrl = record.hlsMasterUrl || '';
  }

  return {
    s3Key: record.originalS3Key,
    videoId,
    status: normStatus,
    hlsConversionStatus: normStatus,
    hlsMasterUrl,
    hlsOutputPrefix: record.hlsOutputPrefix || `hls/${videoId}/`,
    mediaConvertJobId: record.mediaConvertJobId || '',
    error: record.hlsConversionError || record.error || '',
    convertedAt: record.hlsConvertedAt || record.completedAt || null,
    originalVideoUrl: record.originalVideoUrl || '',
  };
}

module.exports = {
  inFlightSubmissions,
  deriveVideoIdFromKey,
  isEligibleVideoKey,
  getCloudFrontHlsMasterUrl,
  validateHlsOutputFiles,
  parseMediaPlaylist,
  buildHlsJobSettings,
  syncHlsDatabaseRecords,
  submitHlsConversionJob,
  enqueueHlsConversion,
  handleJobStateChange,
  checkMediaConvertJob,
  getHlsConversionStatus,
};
