const { getCloudFrontDomain, isTrustedCloudFrontDomain, getValidatedHlsMasterUrl, attachHlsCookiesToResponse } = require('./cloudFrontSecurity');

async function attachVerifiedHlsStream(resource) {
  if (!resource || typeof resource !== 'object') return resource;
  const output = { ...resource };
  const s3Key = String(resource.s3Key || resource.videoS3Key || '').trim();
  let conversion = null;
  if (s3Key) {
    try {
      const { getVerifiedHlsConversionForS3Key } = require('../services/mediaConvertService');
      conversion = await getVerifiedHlsConversionForS3Key(s3Key);
    } catch (_) {
      // Keep the protected S3 video as fallback when conversion lookup is unavailable.
    }
  }
  const status = conversion?.hlsConversionStatus || 'NONE';
  const masterUrl = status === 'COMPLETED' ? conversion.hlsMasterUrl : '';
  const videoId = conversion?.videoId || '';
  output.hlsOutputPrefix = conversion?.hlsOutputPrefix || '';
  output.mediaConvertJobId = conversion?.mediaConvertJobId || '';
  output.hlsConversionStatus = status;
  if (status === 'COMPLETED') {
    try {
      if (!masterUrl) throw new Error('empty-master-url');
      if (!videoId || String(conversion.originalS3Key) !== s3Key) throw new Error('HLS conversion does not match the source video');
      output.hlsMasterUrl = getValidatedHlsMasterUrl(masterUrl, videoId);
      output.hlsPlaybackUrl = output.hlsMasterUrl;
      output.playbackType = 'hls';
    } catch (_) {
      // Do not let one malformed persisted conversion break course serialization.
      // Avoid logging the URL or raw exception, which may contain signed query data.
      console.warn('[HLS] Invalid persisted master URL; using MP4 fallback', {
        videoId: videoId || 'unknown',
        conversionId: conversion?.conversionId || 'unknown',
        reason: masterUrl ? 'master_url_validation_failed' : 'empty_master_url',
      });
      output.hlsConversionStatus = 'FAILED';
      output.hlsConversionError = 'Invalid persisted HLS master URL';
      output.hlsMasterUrl = '';
      output.hlsPlaybackUrl = '';
      output.playbackType = 'mp4';
    }
  } else {
    output.hlsMasterUrl = '';
    output.hlsPlaybackUrl = '';
    output.playbackType = 'mp4';
  }
  return output;
}

function collectCurriculumHlsVideoIds(value, ids = new Set(), visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return ids;
  visited.add(value);
  if (String(value.hlsConversionStatus || '').toUpperCase() === 'COMPLETED') {
    const url = String(value.hlsMasterUrl || value.hlsPlaybackUrl || '').trim();
    if (url) {
      try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/^\/hls\/([A-Za-z0-9_-]+)\/[A-Za-z0-9._-]+\.m3u8$/i);
        if (parsed.protocol !== 'https:' || !isTrustedCloudFrontDomain(parsed.hostname) || !match) {
          throw new Error('Invalid HLS master playlist URL');
        }
        getValidatedHlsMasterUrl(url, match[1]);
        ids.add(match[1]);
      } catch (_) {
        const candidateVideoId = /^[A-Za-z0-9_-]+$/.test(String(value.videoId || '')) ? String(value.videoId) : 'unknown';
        const conversionId = /^[A-Za-z0-9_-]+$/.test(String(value.conversionId || value._id || ''))
          ? String(value.conversionId || value._id)
          : 'unknown';
        console.warn('[HLS] Invalid playlist excluded from signed-cookie policy', {
          videoId: candidateVideoId,
          conversionId,
          reason: 'master_url_validation_failed',
        });
        value.hlsMasterUrl = '';
        value.hlsPlaybackUrl = '';
        value.hlsConversionStatus = 'FAILED';
        value.hlsConversionError = 'Invalid persisted HLS master URL';
        value.playbackType = 'mp4';
        for (const field of ['url', 'secure_url', 'secureUrl', 'fileUrl', 'documentUrl', 'path', 'videoUrl']) {
          try {
            if (/\.m3u8$/i.test(new URL(String(value[field] || '')).pathname)) value[field] = '';
          } catch (_) {}
        }
      }
    }
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectCurriculumHlsVideoIds(item, ids, visited));
    else if (child && typeof child === 'object') collectCurriculumHlsVideoIds(child, ids, visited);
  }
  return ids;
}

function clearCurriculumHlsUrls(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  // Never leave a private CloudFront manifest in a legacy URL alias after
  // signing fails. A verified HLS URL is re-applied by
  // selectCurriculumHlsPlaybackUrls only after cookies have been attached.
  for (const field of ['url', 'secure_url', 'secureUrl', 'fileUrl', 'documentUrl', 'path', 'videoUrl']) {
    if (isPrivateCloudFrontHlsUrl(value[field])) value[field] = '';
  }
  if (String(value.hlsConversionStatus || '').toUpperCase() === 'COMPLETED') {
    value.hlsMasterUrl = '';
    value.hlsPlaybackUrl = '';
    value.playbackType = 'mp4';
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => clearCurriculumHlsUrls(item, visited));
    else if (child && typeof child === 'object') clearCurriculumHlsUrls(child, visited);
  }
}

function isPrivateCloudFrontHlsUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    let configuredDomain = '';
    try { configuredDomain = getCloudFrontDomain().toLowerCase(); } catch (_) {}
    const isMediaHost = (configuredDomain && host === configuredDomain) ||
      host === 'media.whitecoat.academy' || host.endsWith('.cloudfront.net');
    return parsed.protocol === 'https:' && isMediaHost &&
      /^\/hls\/.+\.m3u8$/i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

function clearUnverifiedCloudFrontHlsUrls(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (String(value.playbackType || '').toLowerCase() !== 'hls') {
    for (const field of ['url', 'secure_url', 'secureUrl', 'fileUrl', 'documentUrl', 'path', 'videoUrl']) {
      if (isPrivateCloudFrontHlsUrl(value[field])) value[field] = '';
    }
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => clearUnverifiedCloudFrontHlsUrls(item, visited));
    else if (child && typeof child === 'object') clearUnverifiedCloudFrontHlsUrls(child, visited);
  }
}

function setVideoPartPlaybackUrl(part, url) {
  if (!part || typeof part !== 'object' || !url) return;
  // Keep all legacy aliases in sync because clients use different fields.
  for (const field of ['url', 'secure_url', 'secureUrl', 'fileUrl', 'documentUrl', 'path']) {
    part[field] = url;
  }
}

function selectCurriculumHlsPlaybackUrls(curriculum) {
  // /api/student/courses passes a list of courses; the course-detail endpoint
  // passes a single course object. Handle both shapes so signed HLS URLs are
  // selected consistently before the response is serialized.
  if (Array.isArray(curriculum)) {
    curriculum.forEach((course) => selectCurriculumHlsPlaybackUrls(course));
    return curriculum;
  }
  for (const moduleItem of curriculum?.modules || []) {
    for (const lesson of moduleItem?.lessons || []) {
      const parts = Array.isArray(lesson.videoParts) ? lesson.videoParts : [];
      for (const part of parts) {
        if (String(part?.playbackType || '').toLowerCase() !== 'hls') continue;
        const url = String(part.hlsPlaybackUrl || part.hlsMasterUrl || '').trim();
        if (url) setVideoPartPlaybackUrl(part, url);
      }

      const firstPart = parts[0];
      const firstPartIsHls = String(firstPart?.playbackType || '').toLowerCase() === 'hls' &&
        String(firstPart.hlsPlaybackUrl || firstPart.hlsMasterUrl || '').trim();
      const lessonIsHls = String(lesson.playbackType || '').toLowerCase() === 'hls';
      const lessonHlsUrl = String(lesson.hlsPlaybackUrl || lesson.hlsMasterUrl || '').trim();
      if (lessonIsHls && lessonHlsUrl) lesson.videoUrl = lessonHlsUrl;
      else if (firstPartIsHls) lesson.videoUrl = firstPart.url;
    }
  }
  return curriculum;
}

function attachCurriculumHlsCookies(res, curriculum) {
  clearUnverifiedCloudFrontHlsUrls(curriculum);
  let ids;
  try {
    ids = [...collectCurriculumHlsVideoIds(curriculum)];
  } catch (_) {
    clearCurriculumHlsUrls(curriculum);
    return false;
  }
  if (!ids.length) return true;
  try {
    if (attachHlsCookiesToResponse(res, ids)) {
      selectCurriculumHlsPlaybackUrls(curriculum);
      return true;
    }
  } catch (_) {}
  clearCurriculumHlsUrls(curriculum);
  return false;
}

module.exports = { attachVerifiedHlsStream, collectCurriculumHlsVideoIds, clearCurriculumHlsUrls, clearUnverifiedCloudFrontHlsUrls, isPrivateCloudFrontHlsUrl, selectCurriculumHlsPlaybackUrls, attachCurriculumHlsCookies };
