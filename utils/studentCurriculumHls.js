const { getCloudFrontDomain, getValidatedHlsMasterUrl, attachHlsCookiesToResponse } = require('./cloudFrontSecurity');
const mongoose = require('mongoose');

async function attachVerifiedHlsStream(resource) {
  if (!resource || typeof resource !== 'object') return resource;
  const output = { ...resource };
  let status = String(resource.hlsConversionStatus || 'none').toUpperCase();
  let masterUrl = String(resource.hlsMasterUrl || '').trim();
  const s3Key = String(resource.s3Key || resource.videoS3Key || '').trim();
  if ((!masterUrl || status === 'NONE') && s3Key) {
    try {
      const VideoConversion = require('../models/VideoConversion');
      const connected = mongoose.connection?.readyState === 1;
      if (connected || VideoConversion.findOne !== mongoose.Model.findOne) {
        const query = VideoConversion.findOne({ originalS3Key: s3Key });
        const conversion = query && typeof query.lean === 'function' ? await query.lean() : await query;
        if (conversion) {
          status = String(conversion.hlsConversionStatus || conversion.status || 'none').toUpperCase();
          if (status === 'COMPLETED') masterUrl = String(conversion.hlsMasterUrl || '').trim();
          output.hlsOutputPrefix = conversion.hlsOutputPrefix || output.hlsOutputPrefix || '';
          output.mediaConvertJobId = conversion.mediaConvertJobId || output.mediaConvertJobId || '';
        }
      }
    } catch (_) {
      // Keep the original signed S3 video as fallback when conversion status is unavailable.
    }
  }
  output.hlsConversionStatus = status;
  if (status === 'COMPLETED' && masterUrl) {
    try {
      const videoId = new URL(masterUrl).pathname.match(/^\/hls\/([A-Za-z0-9_-]+)\//)?.[1];
      output.hlsMasterUrl = getValidatedHlsMasterUrl(masterUrl, videoId);
      output.hlsPlaybackUrl = output.hlsMasterUrl;
      output.playbackType = 'hls';
    } catch (_) {
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
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/hls\/([A-Za-z0-9_-]+)\/[A-Za-z0-9._-]+\.m3u8$/i);
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== getCloudFrontDomain().toLowerCase() || !match) {
        throw new Error('Invalid HLS master playlist URL');
      }
      ids.add(match[1]);
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

function attachCurriculumHlsCookies(res, curriculum) {
  let ids;
  try {
    ids = [...collectCurriculumHlsVideoIds(curriculum)];
  } catch (_) {
    clearCurriculumHlsUrls(curriculum);
    return false;
  }
  if (!ids.length) return true;
  try {
    if (attachHlsCookiesToResponse(res, ids)) return true;
  } catch (_) {}
  clearCurriculumHlsUrls(curriculum);
  return false;
}

module.exports = { attachVerifiedHlsStream, collectCurriculumHlsVideoIds, clearCurriculumHlsUrls, attachCurriculumHlsCookies };
