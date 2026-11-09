const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mediaConvertConfig } = require('../config/mediaconvert');
const {
  attachHlsCookiesToResponse,
  generateHlsSignedCookies,
  generateHlsSignedUrl,
  DEFAULT_TTL_SECONDS,
  getValidatedHlsMasterUrl,
} = require('../utils/cloudFrontSecurity');
const {
  attachCurriculumHlsCookies,
  collectCurriculumHlsVideoIds,
} = require('../controllers/studentCurriculumController');

const COOKIE_NAMES = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature'];

function decodePolicy(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

function cookieResponse() {
  return {
    cookies: {},
    cookie(name, value, options) {
      this.cookies[name] = { value, options };
      return this;
    },
  };
}

function withSigningConfig(t) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const env = {
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: process.env.CLOUDFRONT_PRIVATE_KEY,
    cookieDomain: process.env.CLOUDFRONT_COOKIE_DOMAIN,
  };
  const config = {
    keyPairId: mediaConvertConfig.cloudFrontKeyPairId,
    privateKey: mediaConvertConfig.cloudFrontPrivateKey,
    cookieDomain: mediaConvertConfig.cookieDomain,
  };
  process.env.CLOUDFRONT_KEY_PAIR_ID = 'K1XNYI3JNPWK0P';
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;
  process.env.CLOUDFRONT_COOKIE_DOMAIN = '.whitecoat.academy';
  mediaConvertConfig.cloudFrontKeyPairId = '';
  mediaConvertConfig.cloudFrontPrivateKey = '';
  mediaConvertConfig.cookieDomain = '';
  t.after(() => {
    if (env.keyPairId === undefined) delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    else process.env.CLOUDFRONT_KEY_PAIR_ID = env.keyPairId;
    if (env.privateKey === undefined) delete process.env.CLOUDFRONT_PRIVATE_KEY;
    else process.env.CLOUDFRONT_PRIVATE_KEY = env.privateKey;
    if (env.cookieDomain === undefined) delete process.env.CLOUDFRONT_COOKIE_DOMAIN;
    else process.env.CLOUDFRONT_COOKIE_DOMAIN = env.cookieDomain;
    mediaConvertConfig.cloudFrontKeyPairId = config.keyPairId;
    mediaConvertConfig.cloudFrontPrivateKey = config.privateKey;
    mediaConvertConfig.cookieDomain = config.cookieDomain;
  });
}

test('curriculum HLS cookies authorize only the returned videos and all child playlist/segment paths', (t) => {
  withSigningConfig(t);
  const curriculum = {
    modules: [{ lessons: [{
      hlsConversionStatus: 'COMPLETED',
      hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
      hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
      videoParts: [{
        hlsConversionStatus: 'COMPLETED',
        hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-2/cardio-2.m3u8',
        hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-2/cardio-2.m3u8',
      }],
    }] }],
  };
  const res = cookieResponse();

  assert.deepEqual([...collectCurriculumHlsVideoIds(curriculum)].sort(), ['cardio-1', 'cardio-2']);
  assert.equal(attachCurriculumHlsCookies(res, curriculum), true);
  assert.deepEqual(Object.keys(res.cookies).sort(), [...COOKIE_NAMES].sort());

  const policy = decodePolicy(res.cookies['CloudFront-Policy'].value);
  assert.deepEqual(policy.Statement.map((statement) => statement.Resource).sort(), [
    'https://media.whitecoat.academy/hls/cardio-1/*',
    'https://media.whitecoat.academy/hls/cardio-2/*',
  ]);
  assert.ok(policy.Statement.every((statement) => statement.Condition.DateLessThan['AWS:EpochTime'] > Math.floor(Date.now() / 1000)));
  for (const cookieName of COOKIE_NAMES) {
    const options = res.cookies[cookieName].options;
    assert.equal(options.domain, '.whitecoat.academy');
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'None');
    assert.equal(options.path, '/');
  }
});

test('missing signing configuration or an invalid response cannot return an unsigned HLS URL', (t) => {
  withSigningConfig(t);
  const oldKey = process.env.CLOUDFRONT_PRIVATE_KEY;
  const oldConfiguredKey = mediaConvertConfig.cloudFrontPrivateKey;
  delete process.env.CLOUDFRONT_PRIVATE_KEY;
  mediaConvertConfig.cloudFrontPrivateKey = '';

  const curriculum = {
    hlsConversionStatus: 'COMPLETED',
    hlsMasterUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
    hlsPlaybackUrl: 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8',
    playbackType: 'hls',
    url: 'https://authorized.example/video.mp4?signature=local-test',
  };
  const res = cookieResponse();

  assert.throws(() => attachHlsCookiesToResponse(res, 'cardio-1'), /not configured/i);
  assert.equal(attachCurriculumHlsCookies(res, curriculum), false);
  assert.equal(curriculum.hlsMasterUrl, '');
  assert.equal(curriculum.hlsPlaybackUrl, '');
  assert.equal(curriculum.playbackType, 'mp4');
  assert.match(curriculum.url, /video\.mp4/);
  assert.deepEqual(res.cookies, {});

  process.env.CLOUDFRONT_PRIVATE_KEY = oldKey;
  mediaConvertConfig.cloudFrontPrivateKey = oldConfiguredKey;
});

test('custom policy generation rejects invalid video identifiers and master-only signed URLs', () => {
  assert.throws(() => generateHlsSignedCookies(['valid-id', '../other']), /invalid HLS video identifier/i);
  assert.equal(generateHlsSignedUrl('https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8'), 'https://media.whitecoat.academy/hls/cardio-1/cardio-1.m3u8');
});

test('CloudFront cookies default to the one-day maximum and can be renewed with secure attributes intact', (t) => {
  withSigningConfig(t);
  assert.equal(DEFAULT_TTL_SECONDS, 86400);
  const res = cookieResponse();
  const start = Math.floor(Date.now() / 1000);
  attachHlsCookiesToResponse(res, 'cardio-1', 7200);
  const firstExpiry = decodePolicy(res.cookies['CloudFront-Policy'].value).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
  attachHlsCookiesToResponse(res, 'cardio-1', 7200);
  const refreshedExpiry = decodePolicy(res.cookies['CloudFront-Policy'].value).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
  assert.ok(firstExpiry >= start + 7199 && firstExpiry <= start + 7201);
  assert.ok(refreshedExpiry >= firstExpiry);
  for (const cookieName of COOKIE_NAMES) {
    const options = res.cookies[cookieName].options;
    assert.equal(options.domain, '.whitecoat.academy');
    assert.equal(options.path, '/');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'None');
  }
});

test('persisted nonstandard master playlist filename is preserved and unsafe URLs are rejected', () => {
  assert.equal(
    getValidatedHlsMasterUrl('https://media.whitecoat.academy/hls/cardio-1/master-list.m3u8', 'cardio-1'),
    'https://media.whitecoat.academy/hls/cardio-1/master-list.m3u8',
  );
  assert.throws(() => getValidatedHlsMasterUrl('https://evil.example/hls/cardio-1/master-list.m3u8', 'cardio-1'), /invalid HLS master/i);
  assert.throws(() => getValidatedHlsMasterUrl('https://media.whitecoat.academy/hls/other/master-list.m3u8', 'cardio-1'), /invalid HLS master/i);
});
