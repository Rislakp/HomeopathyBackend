const {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { s3Client, bucket } = require('../config/s3');
const Course = require('../models/Course');
const Student = require('../models/Student');
const { verifyStudentCourseAccess } = require('../utils/courseAccessHelper');

const PART_URL_TTL_SECONDS = 900;
const MEDIA_URL_TTL_SECONDS = 900;
const HLS_FALLBACK_URL_TTL_SECONDS = (() => {
  const configured = Number.parseInt(process.env.HLS_FALLBACK_URL_TTL_SECONDS || '', 10);
  return Number.isInteger(configured) && configured >= 900 && configured <= 604800 ? configured : 21600;
})();
const SINGLE_UPLOAD_URL_TTL_SECONDS = 900;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAX_BYTES = 250 * 1024 * 1024;
const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024 * 1024;
const MEDIA_RULES = {
  image: {
    prefix: 'images',
    maxBytes: IMAGE_MAX_BYTES,
    extensions: {
      'image/jpeg': new Set(['jpg', 'jpeg']),
      'image/png': new Set(['png']),
      'image/webp': new Set(['webp']),
      'image/gif': new Set(['gif']),
    },
    types: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  },
  pdf: {
    prefix: 'pdfs',
    maxBytes: PDF_MAX_BYTES,
    extensions: { 'application/pdf': new Set(['pdf']) },
    types: new Set(['application/pdf']),
  },
};

const log = (action, fields = {}) => console.info(`[S3 multipart] ${action}`, fields);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const cleanFileName = (name) => name.trim().replace(/^.*[\\/]/, '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 160);
const validVideoKey = (key) => typeof key === 'string' && /^videos\/\d{13}-(?:[0-9a-f-]{36}-)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(key);
const validStoredKey = (key, prefix) => typeof key === 'string' && key.startsWith(`${prefix}/`) && key.length <= 1024 && !key.includes('..') && !/[\\\r\n]/.test(key);
const validUploadId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 1024 && !/[\r\n]/.test(id);
const safeFileName = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\r\n]/.test(value)) return null;
  const fileName = cleanFileName(value);
  return fileName && fileName !== '.' && fileName !== '..' ? fileName : null;
};
const validSize = (value, maxBytes) => Number.isSafeInteger(value) && value > 0 && value <= maxBytes;
const makeReference = ({ key, fileName, contentType, fileSize, uploadStatus = 'uploaded', hlsConversionStatus, hlsOutputPrefix, hlsMasterUrl }) => ({
  title: fileName,
  url: '',
  secure_url: '',
  secureUrl: '',
  fileUrl: '',
  documentUrl: '',
  path: '',
  storageProvider: 's3',
  s3Key: key,
  resourceType: contentType?.startsWith('video/') ? 'video' : (contentType === 'application/pdf' ? 'pdf' : 'image'),
  resource_type: contentType?.startsWith('video/') ? 'video' : (contentType === 'application/pdf' ? 'raw' : 'image'),
  fileName,
  originalFileName: fileName,
  contentType,
  mimetype: contentType,
  fileSize: fileSize || 0,
  size: fileSize || 0,
  uploadStatus,
  ...(hlsConversionStatus ? { hlsConversionStatus } : {}),
  ...(hlsOutputPrefix ? { hlsOutputPrefix } : {}),
  ...(hlsMasterUrl ? { hlsMasterUrl } : {}),
});
const handleS3Error = (res, error, action) => {
  const status = Number(error.$metadata?.httpStatusCode) || 0;
  const code = error.name || error.Code || 'S3Error';
  console.error(`[S3 multipart] ${action} failed`, { code, status, message: error.message });
  if (status === 404 || ['NoSuchUpload', 'NotFound'].includes(code)) return fail(res, 404, 'Multipart upload was not found.', code);
  if (status === 403 || ['AccessDenied', 'InvalidAccessKeyId'].includes(code)) return fail(res, 502, 'S3 denied the multipart operation.', code);
  if (['EntityTooSmall', 'InvalidPart', 'InvalidPartOrder', 'MalformedXML'].includes(code)) return fail(res, 400, 'S3 rejected the multipart completion data.', code);
  return fail(res, status >= 400 && status < 500 ? status : 502, 'S3 multipart operation failed.', code);
};

const initiateMultipartUpload = async (req, res) => {
  const fileName = req.body?.fileName;
  const contentType = req.body?.contentType;
  const safeName = safeFileName(fileName);
  if (!safeName) return fail(res, 400, 'A valid fileName is required.');
  if (typeof contentType !== 'string' || !/^video\/[a-z0-9][a-z0-9.+-]{0,126}$/i.test(contentType)) return fail(res, 400, 'contentType must be a valid video MIME type.');
  if (req.body?.fileSize !== undefined && !validSize(req.body.fileSize, VIDEO_MAX_BYTES)) return fail(res, 400, 'fileSize must be a positive safe integer no greater than 2 TiB.');
  const key = `videos/${Date.now()}-${randomUUID()}-${safeName}`;
  try {
    const result = await s3Client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
    if (!result.UploadId) throw new Error('S3 did not return an upload ID');
    log('initiated', { key, userId: req.user?.id });
    return res.status(201).json({
      success: true,
      uploadId: result.UploadId,
      key,
      media: makeReference({ key, fileName: safeName, contentType, fileSize: req.body?.fileSize || 0, uploadStatus: 'pending' }),
    });
  } catch (error) { return handleS3Error(res, error, 'initiate'); }
};

const partUrl = async (req, res) => {
  const { uploadId, key, partNumber } = req.body || {};
  const part = Number(partNumber);
  if (!validVideoKey(key)) return fail(res, 400, 'Invalid S3 video key.');
  if (!validUploadId(uploadId)) return fail(res, 400, 'Invalid multipart uploadId.');
  if (!Number.isInteger(part) || part < 1 || part > 10000 || String(partNumber).trim() !== String(part)) return fail(res, 400, 'partNumber must be an integer from 1 to 10000.');
  try {
    const url = await getSignedUrl(s3Client, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: part }), { expiresIn: PART_URL_TTL_SECONDS });
    log('part URL issued', { key, partNumber: part, userId: req.user?.id });
    return res.json({ success: true, url, partNumber: part, expiresIn: PART_URL_TTL_SECONDS });
  } catch (error) { return handleS3Error(res, error, 'part-url'); }
};

const completeMultipartUpload = async (req, res) => {
  const { uploadId, key, parts } = req.body || {};
  if (!validVideoKey(key)) return fail(res, 400, 'Invalid S3 video key.');
  if (!validUploadId(uploadId)) return fail(res, 400, 'Invalid multipart uploadId.');
  if (req.body?.fileName !== undefined && !safeFileName(req.body.fileName)) return fail(res, 400, 'Invalid fileName.');
  if (req.body?.contentType !== undefined && (typeof req.body.contentType !== 'string' || !/^video\/[a-z0-9][a-z0-9.+-]{0,126}$/i.test(req.body.contentType))) return fail(res, 400, 'Invalid video contentType.');
  if (req.body?.fileSize !== undefined && !validSize(req.body.fileSize, VIDEO_MAX_BYTES)) return fail(res, 400, 'Invalid fileSize.');
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 10000) return fail(res, 400, 'parts must contain between 1 and 10000 uploaded parts.');
  const normalized = [];
  const seen = new Set();
  for (const item of parts) {
    const partNumber = Number(item?.partNumber);
    const etag = item?.etag ?? item?.ETag;
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !Number.isInteger(Number(item?.partNumber)) || typeof etag !== 'string' || !/^"?[\da-fA-F-]{16,128}"?$/.test(etag)) return fail(res, 400, 'Each part requires a valid partNumber and ETag.');
    if (seen.has(partNumber)) return fail(res, 400, 'Part numbers must be unique.');
    seen.add(partNumber);
    normalized.push({ PartNumber: partNumber, ETag: etag.startsWith('"') ? etag : `"${etag}"` });
  }
  normalized.sort((a, b) => a.PartNumber - b.PartNumber);
  try {
    const result = await s3Client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: normalized } }));
    const objectMetadata = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (req.body?.fileSize !== undefined && objectMetadata.ContentLength !== req.body.fileSize) {
      console.error('[S3 multipart] completed object size did not match the declared size', { key, expected: req.body.fileSize, actual: objectMetadata.ContentLength });
      return fail(res, 400, 'Uploaded video size does not match fileSize.');
    }
    if (req.body?.contentType && String(objectMetadata.ContentType || '').toLowerCase() !== req.body.contentType.toLowerCase()) {
      console.error('[S3 multipart] completed object content type did not match the declared type', { key, expected: req.body.contentType, actual: objectMetadata.ContentType });
      return fail(res, 400, 'Uploaded video content type does not match contentType.');
    }
    let hlsData = null;
    if (String(objectMetadata.ContentType || req.body?.contentType || '').toLowerCase().startsWith('video/')) {
      try {
        const { enqueueHlsConversion } = require('../services/mediaConvertService');
        hlsData = enqueueHlsConversion(key, { userMetadata: { uploadedBy: String(req.user?.id || '') } });
      } catch (hlsError) {
        console.warn('[S3 multipart] HLS conversion could not be enqueued:', hlsError.message);
      }
    }
    log('completed', { key, partCount: normalized.length, userId: req.user?.id });
    return res.json({
      success: true,
      key,
      location: result.Location,
      etag: result.ETag,
      ...(hlsData ? { hlsConversionStatus: hlsData.status, hlsOutputPrefix: hlsData.hlsOutputPrefix, hlsMasterUrl: hlsData.hlsMasterUrl } : {}),
      media: makeReference({
        key,
        fileName: safeFileName(req.body?.fileName) || key.split('/').pop(),
        contentType: objectMetadata.ContentType || req.body?.contentType || 'application/octet-stream',
        fileSize: objectMetadata.ContentLength || 0,
        hlsConversionStatus: hlsData?.status,
        hlsOutputPrefix: hlsData?.hlsOutputPrefix,
        hlsMasterUrl: hlsData?.hlsMasterUrl,
      }),
    });
  } catch (error) { return handleS3Error(res, error, 'complete'); }
};

const abortMultipartUpload = async (req, res) => {
  const { uploadId, key } = req.body || {};
  if (!validVideoKey(key)) return fail(res, 400, 'Invalid S3 video key.');
  if (!validUploadId(uploadId)) return fail(res, 400, 'Invalid multipart uploadId.');
  try {
    await s3Client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    log('aborted', { key, userId: req.user?.id });
    return res.json({ success: true, key });
  } catch (error) { return handleS3Error(res, error, 'abort'); }
};

const initiateObjectUpload = async (req, res) => {
  const { mediaType, contentType, fileSize } = req.body || {};
  const rule = MEDIA_RULES[mediaType];
  const fileName = safeFileName(req.body?.fileName);
  if (!rule) return fail(res, 400, 'mediaType must be image or pdf.');
  if (!fileName) return fail(res, 400, 'A valid fileName is required.');
  if (typeof contentType !== 'string' || !rule.types.has(contentType.toLowerCase())) {
    return fail(res, 400, `contentType is not supported for ${mediaType} uploads.`);
  }
  const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  if (!rule.extensions[contentType.toLowerCase()]?.has(extension)) return fail(res, 400, 'File extension does not match contentType.');
  if (!validSize(fileSize, rule.maxBytes)) {
    return fail(res, 400, `fileSize must be between 1 byte and ${rule.maxBytes} bytes for ${mediaType} uploads.`);
  }
  const key = `${rule.prefix}/${Date.now()}-${randomUUID()}-${fileName}`;
  try {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType.toLowerCase(), ContentLength: fileSize });
    const url = await getSignedUrl(s3Client, command, { expiresIn: SINGLE_UPLOAD_URL_TTL_SECONDS });
    const media = makeReference({ key, fileName, contentType: contentType.toLowerCase(), fileSize, uploadStatus: 'pending' });
    console.info('[S3 media] upload URL issued', { mediaType, key, fileSize, userId: req.user?.id });
    return res.status(201).json({
      success: true,
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType.toLowerCase() },
      expiresIn: SINGLE_UPLOAD_URL_TTL_SECONDS,
      key,
      media,
    });
  } catch (error) {
    return handleS3Error(res, error, 'object-presign');
  }
};

const completeObjectUpload = async (req, res) => {
  const { mediaType, key, fileName, contentType, fileSize } = req.body || {};
  const rule = MEDIA_RULES[mediaType];
  if (!rule) return fail(res, 400, 'mediaType must be image or pdf.');
  if (!validStoredKey(key, rule.prefix)) return fail(res, 400, 'Invalid S3 object key.');
  const safeName = safeFileName(fileName);
  if (!safeName || typeof contentType !== 'string' || !rule.types.has(contentType.toLowerCase())) return fail(res, 400, 'Valid fileName and contentType are required.');
  const extension = safeName.includes('.') ? safeName.split('.').pop().toLowerCase() : '';
  if (!rule.extensions[contentType.toLowerCase()]?.has(extension)) return fail(res, 400, 'File extension does not match contentType.');
  if (!validSize(fileSize, rule.maxBytes)) return fail(res, 400, 'Invalid fileSize.');
  try {
    const result = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (result.ContentLength !== fileSize || String(result.ContentType || '').toLowerCase() !== contentType.toLowerCase()) {
      return fail(res, 400, 'Uploaded object size or content type does not match the initiation request.');
    }
    const media = makeReference({ key, fileName: safeName, contentType: contentType.toLowerCase(), fileSize, uploadStatus: 'uploaded' });
    console.info('[S3 media] upload verified', { mediaType, key, fileSize, userId: req.user?.id });
    return res.json({ success: true, key, media });
  } catch (error) {
    return handleS3Error(res, error, 'object-complete');
  }
};

const findStudentForMedia = async (user) => {
  if (user.studentId && mongoose.Types.ObjectId.isValid(user.studentId)) {
    const student = await Student.findById(user.studentId);
    if (student) return student;
  }
  const userId = user.id || user.userId;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    const student = await Student.findOne({ userId }) || await Student.findById(userId);
    if (student) return student;
  }
  return user.email ? Student.findOne({ email: user.email.toLowerCase() }) : null;
};

const courseContainsS3Key = (course, key) => {
  if (course.thumbnailMedia?.s3Key === key) return true;
  for (const moduleItem of course.modules || []) {
    for (const lesson of moduleItem.lessons || []) {
      if (lesson.s3Key === key || lesson.videoS3Key === key) return true;
      for (const collection of ['videoParts', 'pdfNotes', 'assignments', 'attachments']) {
        if ((lesson[collection] || []).some((item) => item.s3Key === key)) return true;
      }
    }
  }
  return false;
};

const getMediaAccessUrl = async (req, res) => {
  const courseId = req.query?.courseId || req.body?.courseId;
  const key = req.query?.s3Key || req.query?.key || req.body?.s3Key || req.body?.key;
  if (typeof key !== 'string' || !key.trim()) return fail(res, 400, 's3Key is required.');
  const role = (req.user?.role || '').toLowerCase();
  const requestedKey = key.trim();
  if (role === 'student' && /^(?:videos|live_records)\//i.test(requestedKey)) {
    if (requestedKey.length > 1024 || requestedKey.includes('..') || requestedKey.includes('//') || /[\\\r\n]/.test(requestedKey)) return fail(res, 400, 'Invalid S3 media key.');
    try {
      const { resolveStudentLessonVideoAccess } = require('../utils/studentLessonVideoAccess');
      const access = await resolveStudentLessonVideoAccess({ user: req.user, courseId, s3Key: requestedKey });
      if (access.status !== 200) return fail(res, access.status, access.error);
      const { getHlsConversionStatus } = require('../services/mediaConvertService');
      let hlsInfo = null;
      try { hlsInfo = await getHlsConversionStatus(access.key); } catch (_) {}
      if (String(hlsInfo?.hlsConversionStatus).toUpperCase() === 'COMPLETED' && hlsInfo?.hlsMasterUrl) {
        try {
          const { getValidatedHlsMasterUrl, attachHlsCookiesToResponse } = require('../utils/cloudFrontSecurity');
          const playlistUrl = getValidatedHlsMasterUrl(hlsInfo.hlsMasterUrl, hlsInfo.videoId);
          if (attachHlsCookiesToResponse(res, hlsInfo.videoId)) {
            return res.json({ success: true, url: playlistUrl, hlsMasterUrl: playlistUrl, hlsPlaybackUrl: playlistUrl, s3Key: access.key, key: access.key, playbackType: 'hls', hlsConversionStatus: 'COMPLETED' });
          }
        } catch (_) {
          // Keep the already-authorized S3 MP4 fallback available if HLS URL
          // validation or CloudFront cookie signing is unavailable.
        }
      }
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: access.key }));
      const fallbackUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: access.key, ResponseContentType: 'video/mp4', ResponseContentDisposition: 'inline' }), { expiresIn: HLS_FALLBACK_URL_TTL_SECONDS });
      return res.json({ success: true, url: fallbackUrl, s3Key: access.key, key: access.key, expiresIn: HLS_FALLBACK_URL_TTL_SECONDS, playbackType: 'mp4', hlsConversionStatus: hlsInfo?.hlsConversionStatus || 'PENDING' });
    } catch (error) {
      return handleS3Error(res, error, 'media-access');
    }
  }
  const prefix = ['videos/', 'live_records/', 'images/', 'pdfs/'].find((item) => typeof key === 'string' && key.startsWith(item));
  if (!prefix || !validStoredKey(key, prefix.slice(0, -1))) return fail(res, 400, 'Invalid S3 media key.');
  try {
    const courseResult = courseId
      ? (mongoose.Types.ObjectId.isValid(courseId)
        ? Course.findById(courseId)
        : Course.findOne({ courseId }))
      : Course.findOne({ $or: [
        { 'thumbnailMedia.s3Key': key },
        { 'modules.lessons.s3Key': key },
        { 'modules.lessons.videoS3Key': key },
        { 'modules.lessons.videoParts.s3Key': key },
        { 'modules.lessons.pdfNotes.s3Key': key },
        { 'modules.lessons.assignments.s3Key': key },
        { 'modules.lessons.attachments.s3Key': key },
      ] });
    const course = courseResult && typeof courseResult.lean === 'function' ? await courseResult.lean() : await courseResult;
    if (!course || !courseContainsS3Key(course, key)) return fail(res, 404, 'S3 media was not found in this course.');

    const role = (req.user?.role || '').toLowerCase();
    const isStaff = ['admin', 'superadmin'].includes(role);
    if (!isStaff) {
      const student = await findStudentForMedia(req.user || {});
      if (!student) return fail(res, 403, 'Student profile is required to access course media.');
      const accountOk = ['Active', 'Trial'].includes(student.status) || student.isActive || student.isApproved;
      const subscriptionOk = ['Active', 'Trial'].includes(student.subscriptionStatus) || ['Active', 'VIP', 'Premium'].includes(student.subscription);
      if (!accountOk && !subscriptionOk) return fail(res, 403, 'An active or approved account is required to access course media.');
      if (student.subscriptionExpiresAt && new Date(student.subscriptionExpiresAt) < new Date()) return fail(res, 403, 'Course subscription has expired.');
      if (!await verifyStudentCourseAccess(req.user, course.courseId || course._id.toString())) return fail(res, 403, 'You do not have access to this course.');
    }

    const contentType = ['videos/', 'live_records/'].includes(prefix) ? undefined : (prefix === 'pdfs/' ? 'application/pdf' : undefined);
    const url = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(contentType ? { ResponseContentType: contentType, ResponseContentDisposition: 'inline' } : {}),
    }), { expiresIn: MEDIA_URL_TTL_SECONDS });
    let hlsFields = {};
    if (['videos/', 'live_records/'].includes(prefix)) {
      try {
        const { getHlsConversionStatus } = require('../services/mediaConvertService');
        const status = await getHlsConversionStatus(key);
        if (status.hlsConversionStatus === 'COMPLETED' && status.hlsMasterUrl) {
          const { getValidatedHlsMasterUrl, attachHlsCookiesToResponse } = require('../utils/cloudFrontSecurity');
          const masterUrl = getValidatedHlsMasterUrl(status.hlsMasterUrl, status.videoId);
          if (attachHlsCookiesToResponse(res, status.videoId)) hlsFields = { hlsMasterUrl: masterUrl, hlsPlaybackUrl: masterUrl, hlsOutputPrefix: status.hlsOutputPrefix, hlsConversionStatus: 'COMPLETED', mediaConvertJobId: status.mediaConvertJobId, playbackType: 'hls' };
        } else if (['PENDING', 'PROCESSING'].includes(status.hlsConversionStatus)) {
          hlsFields = { hlsMasterUrl: '', hlsConversionStatus: status.hlsConversionStatus, mediaConvertJobId: status.mediaConvertJobId, playbackType: 'mp4' };
        } else if (status.hlsConversionStatus === 'FAILED') {
          hlsFields = { hlsMasterUrl: '', hlsConversionStatus: 'FAILED', hlsConversionError: status.error, mediaConvertJobId: status.mediaConvertJobId, playbackType: 'mp4' };
        }
      } catch (hlsError) {
        console.warn('[S3 media] HLS status unavailable; preserving authorized MP4 fallback:', hlsError.message);
      }
    }
    console.info('[S3 media] access URL issued', { courseId: String(course.courseId || course._id), key, userId: req.user?.id });
    return res.json({ success: true, url, key, s3Key: key, expiresIn: MEDIA_URL_TTL_SECONDS, ...hlsFields });
  } catch (error) {
    return handleS3Error(res, error, 'media-access');
  }
};

const refreshHlsCookies = (req, res) => getMediaAccessUrl(req, res);

const handleMediaConvertWebhook = async (req, res) => {
  const secret = process.env.HLS_WEBHOOK_SECRET || process.env.MEDIACONVERT_WEBHOOK_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') return res.status(503).json({ success: false, message: 'Webhook authentication is not configured.' });
  if (secret) {
    const incoming = req.headers['x-api-key'] || req.headers['x-webhook-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const supplied = Buffer.from(String(incoming || ''));
    const expected = Buffer.from(secret);
    const { timingSafeEqual } = require('crypto');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ success: false, message: 'Invalid webhook secret.' });
  }
  try {
    const { handleJobStateChange } = require('../services/mediaConvertService');
    return res.status(200).json({ success: true, ...(await handleJobStateChange(req.body)) });
  } catch (_) {
    return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
  }
};

const getMediaConvertJobStatus = async (req, res) => {
  const keyOrJobId = req.params?.keyOrJobId || req.query?.s3Key || req.query?.key || req.query?.jobId || req.body?.s3Key;
  if (!keyOrJobId) return fail(res, 400, 's3Key or jobId is required.');
  try {
    const { getHlsConversionStatus, checkMediaConvertJob } = require('../services/mediaConvertService');
    let status = await getHlsConversionStatus(keyOrJobId);
    if (['PENDING', 'PROCESSING'].includes(status.hlsConversionStatus) && status.mediaConvertJobId) {
      await checkMediaConvertJob(status.mediaConvertJobId).catch(() => {});
      status = await getHlsConversionStatus(keyOrJobId);
    }
    return res.json({ success: true, ...status });
  } catch (_) {
    return fail(res, 500, 'Unable to retrieve HLS conversion status.');
  }
};

const retryMediaConvertJob = async (req, res) => {
  const s3Key = req.body?.s3Key || req.body?.key || req.query?.s3Key;
  if (!s3Key) return fail(res, 400, 's3Key is required.');
  try {
    const { submitHlsConversionJob } = require('../services/mediaConvertService');
    return res.json({ success: true, ...(await submitHlsConversionJob({ s3Key, force: true })) });
  } catch (_) {
    return fail(res, 500, 'Unable to retry HLS conversion.');
  }
};

module.exports = {
  initiateMultipartUpload,
  partUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  initiateObjectUpload,
  completeObjectUpload,
  getMediaAccessUrl,
  refreshHlsCookies,
  handleMediaConvertWebhook,
  getMediaConvertJobStatus,
  retryMediaConvertJob,
};
