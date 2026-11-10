require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const presigner = require('@aws-sdk/s3-request-presigner');

// Mock presigner.getSignedUrl so tests run hermetically without requiring live AWS credentials
const originalGetSignedUrl = presigner.getSignedUrl;
presigner.getSignedUrl = async (_client, command, _options) => {
  const key = command.input?.Key || 'media.mp4';
  return `https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=mock_sig_123&X-Amz-Expires=21600`;
};

const {
  isCloudFrontConfigured,
  signCloudFrontPlaybackUrl,
  getCloudFrontDomain,
  getPrivateKey,
} = require('../utils/cloudFrontMediaSigner');
const { signS3Reference, S3_MEDIA_URL_TTL_SECONDS } = require('../utils/s3MediaSigner');

// Generate a valid RSA test key pair for isolated unit testing
const { privateKey: testPrivateKeyPem } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('1. Feature Flag: isCloudFrontConfigured returns false by default or when disabled', (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  const origDomain = process.env.CLOUDFRONT_DOMAIN;
  const origKeyPair = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
    process.env.CLOUDFRONT_DOMAIN = origDomain;
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPair;
    process.env.CLOUDFRONT_PRIVATE_KEY = origKey;
  });

  // Default / false
  process.env.CLOUDFRONT_ENABLED = 'false';
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2TESTKEYPAIR';
  process.env.CLOUDFRONT_PRIVATE_KEY = testPrivateKeyPem;
  assert.strictEqual(isCloudFrontConfigured(), false, 'Must be false when CLOUDFRONT_ENABLED is false');

  // Incomplete: missing private key
  process.env.CLOUDFRONT_ENABLED = 'true';
  delete process.env.CLOUDFRONT_PRIVATE_KEY;
  delete process.env.CLOUDFRONT_PRIVATE_KEY_BASE64;
  assert.strictEqual(isCloudFrontConfigured(), false, 'Must be false when private key is missing');

  // Incomplete: missing key pair ID
  process.env.CLOUDFRONT_PRIVATE_KEY = testPrivateKeyPem;
  delete process.env.CLOUDFRONT_KEY_PAIR_ID;
  assert.strictEqual(isCloudFrontConfigured(), false, 'Must be false when key pair ID is missing');
});

test('2. Fallback to S3: When CloudFront is disabled, signS3Reference returns S3 SigV4 URL', async (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
  });

  process.env.CLOUDFRONT_ENABLED = 'false';
  const sampleRef = { storageProvider: 's3', s3Key: 'videos/test-playback.mp4' };
  const signed = await signS3Reference(sampleRef, 'video/mp4');

  assert.ok(signed.url, 'URL must be present');
  assert.ok(
    signed.url.includes('X-Amz-Signature') || signed.url.includes('amazonaws.com'),
    'Must be an S3 SigV4 URL when CloudFront is disabled'
  );
  assert.strictEqual(signed.deliveryProvider, undefined, 'deliveryProvider should not be cloudfront when disabled');
});

test('3. CloudFront Playback: Generates valid CloudFront Canned Policy signed URL when enabled', (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  const origDomain = process.env.CLOUDFRONT_DOMAIN;
  const origKeyPair = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
    process.env.CLOUDFRONT_DOMAIN = origDomain;
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPair;
    process.env.CLOUDFRONT_PRIVATE_KEY = origKey;
  });

  process.env.CLOUDFRONT_ENABLED = 'true';
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2TESTKEYPAIRID';
  process.env.CLOUDFRONT_PRIVATE_KEY = testPrivateKeyPem;

  assert.strictEqual(isCloudFrontConfigured(), true, 'Must report configured when all credentials are set');

  const signedUrl = signCloudFrontPlaybackUrl('videos/surgery_lecture.mp4', { expiresIn: 7200 });
  assert.ok(signedUrl.startsWith('https://media.whitecoat.academy/videos/surgery_lecture.mp4'), 'Must target CloudFront domain and path');
  assert.ok(signedUrl.includes('Expires='), 'Must contain Expires parameter');
  assert.ok(signedUrl.includes('Signature='), 'Must contain Signature parameter');
  assert.ok(signedUrl.includes('Key-Pair-Id=K2TESTKEYPAIRID'), 'Must contain Key-Pair-Id parameter');
});

test('4. Integration: signS3Reference emits CloudFront deliveryProvider when enabled', async (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  const origDomain = process.env.CLOUDFRONT_DOMAIN;
  const origKeyPair = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
    process.env.CLOUDFRONT_DOMAIN = origDomain;
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPair;
    process.env.CLOUDFRONT_PRIVATE_KEY = origKey;
  });

  process.env.CLOUDFRONT_ENABLED = 'true';
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2TESTKEYPAIRID';
  process.env.CLOUDFRONT_PRIVATE_KEY = testPrivateKeyPem;

  const sampleRef = { storageProvider: 's3', s3Key: 'videos/anatomy_class.mp4' };
  const signed = await signS3Reference(sampleRef, 'video/mp4');

  assert.ok(signed.url.startsWith('https://media.whitecoat.academy/videos/anatomy_class.mp4'), 'URL must point to CloudFront');
  assert.strictEqual(signed.deliveryProvider, 'cloudfront', 'deliveryProvider must be set to cloudfront');
});

test('5. Graceful Fallback: When CloudFront signing fails, falls back safely to S3 SigV4', async (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  const origDomain = process.env.CLOUDFRONT_DOMAIN;
  const origKeyPair = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
    process.env.CLOUDFRONT_DOMAIN = origDomain;
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPair;
    process.env.CLOUDFRONT_PRIVATE_KEY = origKey;
  });

  // Enable with an invalid/corrupt private key string to simulate signing runtime failure
  process.env.CLOUDFRONT_ENABLED = 'true';
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2TESTKEYPAIRID';
  process.env.CLOUDFRONT_PRIVATE_KEY = 'INVALID_RSA_KEY_DATA';

  const sampleRef = { storageProvider: 's3', s3Key: 'videos/pathology.mp4' };
  const signed = await signS3Reference(sampleRef, 'video/mp4');

  assert.ok(signed.url, 'Must not throw and must still return a signed URL');
  assert.ok(
    signed.url.includes('X-Amz-Signature') || signed.url.includes('amazonaws.com'),
    'Must fall back to S3 SigV4 URL when CloudFront fails'
  );
  assert.notStrictEqual(signed.deliveryProvider, 'cloudfront', 'deliveryProvider must not be cloudfront on fallback');
});

test('6. Base64 Private Key Support: Successfully decodes base64-encoded PEM private key', (t) => {
  const origEnabled = process.env.CLOUDFRONT_ENABLED;
  const origDomain = process.env.CLOUDFRONT_DOMAIN;
  const origKeyPair = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const origKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const origB64 = process.env.CLOUDFRONT_PRIVATE_KEY_BASE64;

  t.after(() => {
    process.env.CLOUDFRONT_ENABLED = origEnabled;
    process.env.CLOUDFRONT_DOMAIN = origDomain;
    process.env.CLOUDFRONT_KEY_PAIR_ID = origKeyPair;
    process.env.CLOUDFRONT_PRIVATE_KEY = origKey;
    process.env.CLOUDFRONT_PRIVATE_KEY_BASE64 = origB64;
  });

  delete process.env.CLOUDFRONT_PRIVATE_KEY;
  process.env.CLOUDFRONT_ENABLED = 'true';
  process.env.CLOUDFRONT_DOMAIN = 'media.whitecoat.academy';
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K2B64KEYID';
  process.env.CLOUDFRONT_PRIVATE_KEY_BASE64 = Buffer.from(testPrivateKeyPem, 'utf8').toString('base64');

  assert.strictEqual(isCloudFrontConfigured(), true, 'Must support base64 private key');
  const signedUrl = signCloudFrontPlaybackUrl('videos/base64_test.mp4');
  assert.ok(signedUrl.includes('Key-Pair-Id=K2B64KEYID'), 'URL must be successfully signed with base64 key');
});
