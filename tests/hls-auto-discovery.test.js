require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveVideoIdFromKey,
  getHlsConversionStatus,
  discoverHlsInS3,
} = require('../services/mediaConvertService');
const { resolvePersistedHlsUrl } = require('../utils/cloudFrontSecurity');

test('HLS S3 Auto-Discovery: derives candidate videoIds accurately', () => {
  const s3Key = 'videos/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4';
  const derived = deriveVideoIdFromKey(s3Key);
  assert.equal(derived, '1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4');

  // Verify that resolvePersistedHlsUrl automatically resolves folder prefix
  const persistedUrl = 'https://media.whitecoat.academy/hls/PHARMACY-4/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.m3u8';
  const resolved = resolvePersistedHlsUrl(persistedUrl, derived);
  assert.equal(resolved, persistedUrl);
});

test('HLS S3 Auto-Discovery: discovers real PHARMACY-4 HLS assets in S3 when DB record is missing', async () => {
  const s3Key = 'videos/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4';
  const result = await discoverHlsInS3(s3Key);

  if (result) {
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.hlsConversionStatus, 'COMPLETED');
    assert.equal(result.videoId, 'PHARMACY-4');
    assert.match(result.hlsMasterUrl, /\.m3u8$/);
    assert.match(result.hlsMasterUrl, /https:\/\/media\.whitecoat\.academy\/hls\/PHARMACY-4\//);
  }
});

test('HLS S3 Auto-Discovery: getHlsConversionStatus returns COMPLETED for PHARMACY-4 video key', async () => {
  const s3Key = 'videos/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4';
  const info = await getHlsConversionStatus(s3Key);

  assert.equal(info.status, 'COMPLETED');
  assert.equal(info.hlsConversionStatus, 'COMPLETED');
  assert.match(info.hlsMasterUrl, /\.m3u8$/);
});
