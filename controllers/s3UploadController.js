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
const { s3Client, bucket, region, isS3Configured } = require('../config/s3');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const DemoVideo = require('../models/DemoVideo');
const Lesson = require('../models/Lesson.model');
const Student = require('../models/Student');
const { getS3Url, getS3KeyFromUrl } = require('../services/s3Service');
const { verifyStudentCourseAccess } = require('../utils/courseAccessHelper');
const { normalizeS3Reference } = require('../utils/s3MediaSigner');

const PART_URL_TTL_SECONDS = 900;
const MEDIA_URL_TTL_SECONDS = 900;
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
const makeReference = ({ key, fileName, contentType, fileSize, uploadStatus = 'uploaded' }) => ({
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
});
const handleS3Error = (res, error, action) => {
  const status = Number(error.$metadata?.httpStatusCode) || 0;
  const code = error.name || error.Code || 'S3Error';
  const isSingleObject = ['object-presign', 'object-complete', 'media-access'].includes(action);
  const operationType = isSingleObject ? 'object' : 'multipart';

  console.error(`[S3 ${operationType}] ${action} failed:`, {
    action,
    code,
    status,
    message: error.message,
    hasCredentials: Boolean(
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.S3_ACCESS_KEY ||
      process.env.AWS_KEY
    ),
    region: process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'whitecoat-media-prod',
  });

  if (code === 'CredentialsProviderError' || code === 'NoCredentials' || error.message?.includes('Could not load credentials')) {
    return fail(
      res,
      503,
      'S3 upload service is not configured',
      'CredentialsProviderError'
    );
  }
  if (status === 404 || ['NoSuchUpload', 'NotFound', 'NoSuchBucket', 'NoSuchKey'].includes(code)) {
    return fail(res, 404, isSingleObject ? 'S3 resource or bucket was not found.' : 'Multipart upload was not found.', code);
  }
  if (status === 403 || ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(code)) {
    return fail(res, 502, 'S3 denied the operation. Check AWS credentials, region, and bucket permissions.', code);
  }
  if (['EntityTooSmall', 'InvalidPart', 'InvalidPartOrder', 'MalformedXML'].includes(code)) {
    return fail(res, 400, 'S3 rejected the upload completion data.', code);
  }
  return fail(res, status >= 400 && status < 500 ? status : 502, error.message || `S3 ${operationType} operation failed.`, code);
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
    log('completed', { key, partCount: normalized.length, userId: req.user?.id });
    return res.json({
      success: true,
      key,
      location: result.Location,
      etag: result.ETag,
      media: makeReference({
        key,
        fileName: safeFileName(req.body?.fileName) || key.split('/').pop(),
        contentType: objectMetadata.ContentType || req.body?.contentType || 'application/octet-stream',
        fileSize: objectMetadata.ContentLength || 0,
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

  const s3Ready = isS3Configured();
  const key = `${rule.prefix}/${Date.now()}-${randomUUID()}-${fileName}`;

  console.info('[S3 PRESIGN]', {
    'bucket configured': Boolean(bucket),
    'region configured': Boolean(region),
    'credentials configured': s3Ready,
    'requested key': key,
    'requested content type': contentType.toLowerCase(),
    'generated presigned URL': false,
  });

  if (!s3Ready) {
    console.error('[S3 PRESIGN] S3 upload service is not configured (missing credentials or bucket)');
    return fail(res, 503, 'S3 upload service is not configured', 'S3NotConfigured');
  }

  try {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType.toLowerCase(), ContentLength: fileSize });
    const url = await getSignedUrl(s3Client, command, { expiresIn: SINGLE_UPLOAD_URL_TTL_SECONDS });
    const media = makeReference({ key, fileName, contentType: contentType.toLowerCase(), fileSize, uploadStatus: 'pending' });
    console.info('[S3 PRESIGN]', {
      'bucket configured': Boolean(bucket),
      'region configured': Boolean(region),
      'credentials configured': true,
      'requested key': key,
      'requested content type': contentType.toLowerCase(),
      'generated presigned URL': Boolean(url),
    });
    console.info('[S3 media] upload URL issued', { mediaType, key, fileSize, userId: req.user?.id });
    return res.status(200).json({
      success: true,
      url,
      uploadUrl: url,
      presignedUrl: url,
      method: 'PUT',
      headers: { 'Content-Type': contentType.toLowerCase() },
      expiresIn: SINGLE_UPLOAD_URL_TTL_SECONDS,
      key,
      s3Key: key,
      media,
    });
  } catch (error) {
    console.info('[S3 PRESIGN]', {
      'bucket configured': Boolean(bucket),
      'region configured': Boolean(region),
      'credentials configured': s3Ready,
      'requested key': key,
      'requested content type': contentType.toLowerCase(),
      'generated presigned URL': false,
    });
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

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const courseContainsMediaKey = (course, key) => {
  if (!course) return false;
  if (course.thumbnailMedia?.s3Key === key || getS3KeyFromUrl(course.thumbnailMedia?.url) === key) return true;
  if (getS3KeyFromUrl(course.thumbnail) === key) return true;
  if (getS3KeyFromUrl(course.bannerUrl) === key) return true;
  if (getS3KeyFromUrl(course.courseBanner) === key) return true;
  for (const moduleItem of course.modules || []) {
    for (const lesson of moduleItem.lessons || []) {
      if (lesson.videoS3Key === key || lesson.s3Key === key) return true;
      if (getS3KeyFromUrl(lesson.videoUrl) === key) return true;
      if (normalizeS3Reference(lesson.videoUrl)?.s3Key === key) return true;
      if (getS3KeyFromUrl(lesson.fileUrl) === key) return true;
      if (getS3KeyFromUrl(lesson.pdfUrl) === key) return true;
      if (getS3KeyFromUrl(lesson.documentUrl) === key) return true;
      if (getS3KeyFromUrl(lesson.url) === key) return true;
      if (getS3KeyFromUrl(lesson.path) === key) return true;
      for (const collection of ['videoParts', 'pdfNotes', 'assignments', 'attachments']) {
        if ((lesson[collection] || []).some((item) => (
          item.s3Key === key ||
          getS3KeyFromUrl(item.url) === key ||
          getS3KeyFromUrl(item.secure_url) === key ||
          getS3KeyFromUrl(item.secureUrl) === key ||
          getS3KeyFromUrl(item.fileUrl) === key ||
          getS3KeyFromUrl(item.documentUrl) === key ||
          getS3KeyFromUrl(item.path) === key
        ))) return true;
      }
    }
  }
  return false;
};

const getMediaAccessUrl = async (req, res) => {
  const courseId = req.query?.courseId || req.body?.courseId;
  const rawKey = req.query?.s3Key || req.query?.key || req.body?.s3Key || req.body?.key;
  if (typeof rawKey !== 'string' || !rawKey.trim()) return fail(res, 400, 's3Key is required.');

  // Handle legacy Cloudinary or local media URLs seamlessly
  const trimmedRawKey = rawKey.trim();
  if (trimmedRawKey.includes('cloudinary.com') || trimmedRawKey.startsWith('/uploads/')) {
    return res.json({ success: true, url: trimmedRawKey, key: trimmedRawKey, s3Key: trimmedRawKey });
  }

  const key = getS3KeyFromUrl(trimmedRawKey) || trimmedRawKey;
  const prefix = ['videos/', 'images/', 'pdfs/', 'live_records/'].find((item) => typeof key === 'string' && key.startsWith(item));
  if (!prefix || !validStoredKey(key, prefix.slice(0, -1))) return fail(res, 400, 'Invalid S3 media key.');

  try {
    let resolvedCourse = null;
    let foundMedia = false;
    let recordingDoc = null;
    let demoVideoDoc = null;

    // 1. If courseId is explicitly provided, verify media belongs to this course
    if (courseId) {
      resolvedCourse = mongoose.Types.ObjectId.isValid(courseId)
        ? await Course.findById(courseId)
        : await Course.findOne({ courseId });

      if (resolvedCourse && courseContainsMediaKey(resolvedCourse, key)) {
        foundMedia = true;
      }

      if (!foundMedia && resolvedCourse) {
        // Check recordings linked to this course
        const courseIdQuery = [];
        if (mongoose.Types.ObjectId.isValid(resolvedCourse._id)) {
          courseIdQuery.push({ courseId: resolvedCourse._id });
        }
        if (resolvedCourse.courseTitle) {
          courseIdQuery.push({ courseName: resolvedCourse.courseTitle });
        }
        if (courseIdQuery.length > 0) {
          recordingDoc = await Recording.findOne({
            $and: [
              { $or: courseIdQuery },
              {
                $or: [
                  { s3Key: key },
                  { recordedVideoUrl: { $regex: escapeRegex(key) } },
                  { recordingFileUrl: { $regex: escapeRegex(key) } },
                  { streamUrl: { $regex: escapeRegex(key) } },
                  { liveClassUrl: { $regex: escapeRegex(key) } },
                ],
              },
            ],
          });
          if (recordingDoc) foundMedia = true;
        }
      }

      if (!foundMedia && resolvedCourse) {
        // Check demo videos linked to this course
        const demoCourseQuery = [];
        if (resolvedCourse.courseId) {
          demoCourseQuery.push({ courseId: resolvedCourse.courseId });
        }
        if (mongoose.Types.ObjectId.isValid(resolvedCourse._id)) {
          demoCourseQuery.push({ courseRef: resolvedCourse._id });
        }
        if (demoCourseQuery.length > 0) {
          demoVideoDoc = await DemoVideo.findOne({
            $and: [
              { $or: demoCourseQuery },
              {
                $or: [
                  { s3Key: key },
                  { videoUrl: { $regex: escapeRegex(key) } },
                  { thumbnailUrl: { $regex: escapeRegex(key) } },
                ],
              },
            ],
          });
          if (demoVideoDoc) foundMedia = true;
        }
      }

      if (!foundMedia && resolvedCourse) {
        // Check standalone lessons linked to this course
        const standaloneLesson = await Lesson.findOne({
          $and: [
            { courseId: resolvedCourse.courseId },
            {
              $or: [
                { s3Key: key },
                { uploadFileOrLink: { $regex: escapeRegex(key) } },
              ],
            },
          ],
        });
        if (standaloneLesson) foundMedia = true;
      }

      if (!foundMedia) {
        return fail(res, 404, 'S3 media was not found in this course.');
      }
    } else {
      // 2. No courseId specified: search across Course, Recording, DemoVideo, and Lesson
      resolvedCourse = await Course.findOne({
        $or: [
          { 'thumbnailMedia.s3Key': key },
          { 'thumbnailMedia.url': { $regex: escapeRegex(key) } },
          { thumbnail: { $regex: escapeRegex(key) } },
          { bannerUrl: { $regex: escapeRegex(key) } },
          { courseBanner: { $regex: escapeRegex(key) } },
          { 'modules.lessons.videoS3Key': key },
          { 'modules.lessons.s3Key': key },
          { 'modules.lessons.videoUrl': { $regex: escapeRegex(key) } },
          { 'modules.lessons.fileUrl': { $regex: escapeRegex(key) } },
          { 'modules.lessons.pdfUrl': { $regex: escapeRegex(key) } },
          { 'modules.lessons.documentUrl': { $regex: escapeRegex(key) } },
          { 'modules.lessons.url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.path': { $regex: escapeRegex(key) } },
          { 'modules.lessons.videoParts.s3Key': key },
          { 'modules.lessons.videoParts.url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.videoParts.secure_url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.videoParts.secureUrl': { $regex: escapeRegex(key) } },
          { 'modules.lessons.pdfNotes.s3Key': key },
          { 'modules.lessons.pdfNotes.url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.pdfNotes.secure_url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.assignments.s3Key': key },
          { 'modules.lessons.assignments.url': { $regex: escapeRegex(key) } },
          { 'modules.lessons.attachments.s3Key': key },
          { 'modules.lessons.attachments.url': { $regex: escapeRegex(key) } },
        ],
      });

      if (resolvedCourse && courseContainsMediaKey(resolvedCourse, key)) {
        foundMedia = true;
      }

      if (!foundMedia) {
        recordingDoc = await Recording.findOne({
          $or: [
            { s3Key: key },
            { recordedVideoUrl: { $regex: escapeRegex(key) } },
            { recordingFileUrl: { $regex: escapeRegex(key) } },
            { streamUrl: { $regex: escapeRegex(key) } },
            { liveClassUrl: { $regex: escapeRegex(key) } },
          ],
        });
        if (recordingDoc) {
          foundMedia = true;
          if (recordingDoc.courseId) {
            resolvedCourse = await Course.findById(recordingDoc.courseId);
          } else if (recordingDoc.courseName) {
            resolvedCourse = await Course.findOne({ courseTitle: recordingDoc.courseName });
          }
        }
      }

      if (!foundMedia) {
        demoVideoDoc = await DemoVideo.findOne({
          $or: [
            { s3Key: key },
            { videoUrl: { $regex: escapeRegex(key) } },
            { thumbnailUrl: { $regex: escapeRegex(key) } },
          ],
        });
        if (demoVideoDoc) {
          foundMedia = true;
          if (demoVideoDoc.courseRef) {
            resolvedCourse = await Course.findById(demoVideoDoc.courseRef);
          }
          if (!resolvedCourse && demoVideoDoc.courseId) {
            resolvedCourse = await Course.findOne({
              $or: [
                { courseId: demoVideoDoc.courseId },
                ...(mongoose.Types.ObjectId.isValid(demoVideoDoc.courseId) ? [{ _id: demoVideoDoc.courseId }] : []),
              ],
            });
          }
        }
      }

      if (!foundMedia) {
        const standaloneLesson = await Lesson.findOne({
          $or: [
            { s3Key: key },
            { uploadFileOrLink: { $regex: escapeRegex(key) } },
          ],
        });
        if (standaloneLesson) {
          foundMedia = true;
          if (standaloneLesson.courseId) {
            resolvedCourse = await Course.findOne({
              $or: [
                { courseId: standaloneLesson.courseId },
                ...(mongoose.Types.ObjectId.isValid(standaloneLesson.courseId) ? [{ _id: standaloneLesson.courseId }] : []),
              ],
            });
          }
        }
      }

      if (!foundMedia) {
        return fail(res, 404, 'S3 media was not found in a course or recording.');
      }
    }

    // 3. User Authorization
    const role = (req.user?.role || '').toLowerCase();
    const isStaff = ['admin', 'superadmin'].includes(role);
    if (!isStaff) {
      if (!resolvedCourse) {
        return fail(res, 403, 'Course access is required to access this media.');
      }
      const student = await findStudentForMedia(req.user || {});
      if (!student) return fail(res, 403, 'Student profile is required to access course media.');
      const accountOk = ['Active', 'Trial'].includes(student.status) || student.isActive || student.isApproved;
      const subscriptionOk = ['Active', 'Trial'].includes(student.subscriptionStatus) || ['Active', 'VIP', 'Premium'].includes(student.subscription);
      if (!accountOk && !subscriptionOk) return fail(res, 403, 'An active or approved account is required to access course media.');
      if (student.subscriptionExpiresAt && new Date(student.subscriptionExpiresAt) < new Date()) return fail(res, 403, 'Course subscription has expired.');
      if (!await verifyStudentCourseAccess(req.user, resolvedCourse.courseId || resolvedCourse._id.toString())) {
        return fail(res, 403, 'You do not have access to this course.');
      }
    }

    // 4. Generate SigV4 signed URL
    const contentType = (prefix === 'videos/' || prefix === 'live_records/') ? undefined : (prefix === 'pdfs/' ? 'application/pdf' : undefined);
    const url = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(contentType ? { ResponseContentType: contentType, ResponseContentDisposition: 'inline' } : {}),
    }), { expiresIn: MEDIA_URL_TTL_SECONDS });

    const mediaOwnerId = resolvedCourse?.courseId || resolvedCourse?._id || recordingDoc?.courseId || recordingDoc?._id || demoVideoDoc?.courseId || 'authorized-media';
    console.info('[S3 media] access URL issued', { courseId: String(mediaOwnerId), key, userId: req.user?.id });
    return res.json({ success: true, url, key, s3Key: key, expiresIn: MEDIA_URL_TTL_SECONDS });
  } catch (error) {
    return handleS3Error(res, error, 'media-access');
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
};
