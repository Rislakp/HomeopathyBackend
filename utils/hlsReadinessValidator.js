const { HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// In-memory cache of verified HLS assets with 10-minute TTL to prevent redundant S3 HEAD calls
const readinessCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function clearReadinessCache() {
  readinessCache.clear();
}

/**
 * Validates that an HLS asset is truly ready in S3 before serving it to clients.
 * Confirms:
 * 1. The master playlist exists in S3 and has ContentLength > 0.
 * 2. Variant playlists and/or media segments exist under the output prefix.
 *
 * If validation fails or objects are missing, callers must fall back to the presigned MP4 stream.
 */
async function validateHlsS3Readiness({ s3Client, bucket, hlsInfo }) {
  if (!hlsInfo || !hlsInfo.videoId || !s3Client || !bucket) {
    return { ready: false, masterKey: null, reason: 'Missing S3 client, bucket, or HLS metadata' };
  }

  const videoId = String(hlsInfo.videoId).trim();
  const cached = readinessCache.get(videoId);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return { ready: true, masterKey: cached.masterKey };
  }

  const prefix = (hlsInfo.hlsOutputPrefix || `hls/${videoId}/`).replace(/^\/+/, '');

  // Potential master playlist keys in S3:
  const candidateKeys = [];
  if (hlsInfo.hlsMasterUrl) {
    try {
      const parsed = new URL(hlsInfo.hlsMasterUrl);
      const pathnameKey = parsed.pathname.replace(/^\/+/, '');
      if (pathnameKey) candidateKeys.push(pathnameKey);
    } catch (_) {}
  }
  candidateKeys.push(`${prefix}${videoId}.m3u8`);
  candidateKeys.push(`${prefix}master.m3u8`);

  const uniqueKeys = [...new Set(candidateKeys)];
  let verifiedMasterKey = null;

  for (const candidateKey of uniqueKeys) {
    try {
      const head = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: candidateKey,
      }));
      if (head && Number(head.ContentLength) > 0) {
        verifiedMasterKey = candidateKey;
        break;
      }
    } catch (_) {
      // Try next candidate
    }
  }

  if (!verifiedMasterKey) {
    return {
      ready: false,
      masterKey: null,
      reason: `Master playlist not found in S3 (checked: ${uniqueKeys.join(', ')})`,
    };
  }

  // Next verify that at least one variant playlist or segment exists in S3
  let hasVariantOrSegment = false;
  const candidateVariants = [
    `${prefix}${videoId}_480p.m3u8`,
    `${prefix}${videoId}_360p.m3u8`,
    `${prefix}_480p.m3u8`,
    `${prefix}_360p.m3u8`,
  ];

  for (const vKey of candidateVariants) {
    try {
      const vHead = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: vKey,
      }));
      if (vHead && Number(vHead.ContentLength) > 0) {
        hasVariantOrSegment = true;
        break;
      }
    } catch (_) {}
  }

  // If direct head on common variant names didn't find them, list prefix
  if (!hasVariantOrSegment && typeof s3Client.send === 'function') {
    try {
      const listRes = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 5,
      }));
      const contents = listRes?.Contents || [];
      const validFiles = contents.filter((o) => o.Key !== verifiedMasterKey && Number(o.Size) > 0);
      if (validFiles.length > 0) {
        hasVariantOrSegment = true;
      }
    } catch (_) {}
  }

  if (!hasVariantOrSegment) {
    return {
      ready: false,
      masterKey: verifiedMasterKey,
      reason: `Variant playlists or segment files not found in S3 under prefix ${prefix}`,
    };
  }

  readinessCache.set(videoId, {
    ready: true,
    masterKey: verifiedMasterKey,
    timestamp: Date.now(),
  });

  return { ready: true, masterKey: verifiedMasterKey };
}

module.exports = {
  validateHlsS3Readiness,
  clearReadinessCache,
};

