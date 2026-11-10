const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/s3');
const { resolveProfileImageUrl, normalizeS3Reference, signS3Reference } = require('../utils/s3MediaSigner');
const unaniRankService = require('../src/unani/ranks/services/unaniRank.service');
const unaniReviewService = require('../src/unani/reviews/services/unaniReview.service');
const UnaniRank = require('../src/unani/ranks/models/unaniRank.model');
const UnaniReview = require('../src/unani/reviews/models/unaniReview.model');

// Synthetic in-memory credentials for local test environment
const defaultCredentialProvider = config.s3Client.config.credentials;
config.s3Client.config.credentials = async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'local-test-only-secret' });
process.on('exit', () => { config.s3Client.config.credentials = defaultCredentialProvider; });

test('1. Rank Holder S3 image key converts to SigV4 presigned URL', async (t) => {
  const s3Key = 'unani_ranks/1790913540090-620604d8-rank.png';
  const resolved = await resolveProfileImageUrl(s3Key);

  assert.match(resolved, /^https:\/\/whitecoat-media-prod\.s3\.us-east-1\.amazonaws\.com\/unani_ranks\//);
  assert.match(resolved, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(resolved, /X-Amz-Credential=/);
  assert.match(resolved, /X-Amz-Signature=/);
});

test('2. Raw private S3 URL is normalized to S3 key and converted to presigned GET URL', async (t) => {
  const rawS3Url = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/reviews/1790913816124-c8035f3a-review.jpeg';
  const resolved = await resolveProfileImageUrl(rawS3Url);

  assert.notEqual(resolved, rawS3Url, 'Private raw S3 URL must NOT be returned directly to the frontend');
  assert.match(resolved, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(resolved, /X-Amz-Signature=/);
});

test('3. Legacy Cloudinary image URL remains unchanged', async (t) => {
  const cloudinaryUrl = 'https://res.cloudinary.com/vadgpisw/image/upload/v12345678/unani_rank_sample.jpg';
  const resolved = await resolveProfileImageUrl(cloudinaryUrl);

  assert.equal(resolved, cloudinaryUrl, 'Cloudinary URL must remain untouched');
});

test('4. External image URL remains unchanged', async (t) => {
  const externalUrl = 'https://external-domain.org/assets/doctor-profile.jpg';
  const resolved = await resolveProfileImageUrl(externalUrl);

  assert.equal(resolved, externalUrl, 'External image URL must remain untouched');
});

test('5. Invalid or missing S3 image is handled gracefully', async (t) => {
  const emptyRes = await resolveProfileImageUrl('');
  assert.equal(emptyRes, '');

  const nullRes = await resolveProfileImageUrl(null);
  assert.equal(nullRes, null);

  const invalidKeyRes = await resolveProfileImageUrl('../etc/passwd');
  assert.equal(invalidKeyRes, '../etc/passwd', 'Invalid path traversal key should not generate signed URL');
});

test('6. unaniRankService.getPublicRanks returns presigned S3 URLs for S3 rank holders', async (t) => {
  const origFind = UnaniRank.find;
  UnaniRank.find = () => ({
    sort: () => ({
      lean: async () => [
        { _id: '6abf480c86f162ff405daf89', name: 'Dr S3 Ranker', profileImage: 'unani_ranks/ranker1.jpg', isActive: true, courseId: 'unani', displayOrder: 1 },
        { _id: '6abf480c86f162ff405daf90', name: 'Dr Cloudinary Ranker', profileImage: 'https://res.cloudinary.com/demo/sample.png', isActive: true, courseId: 'unani', displayOrder: 2 },
      ],
    }),
  });
  t.after(() => { UnaniRank.find = origFind; });

  const publicRanks = await unaniRankService.getPublicRanks();
  assert.equal(publicRanks.length, 2);
  assert.match(publicRanks[0].profileImage, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.equal(publicRanks[1].profileImage, 'https://res.cloudinary.com/demo/sample.png');
});

test('7. unaniReviewService.getPublicReviews returns presigned S3 URLs for S3 reviewers', async (t) => {
  const origFind = UnaniReview.find;
  UnaniReview.find = () => ({
    sort: () => ({
      lean: async () => [
        { _id: '6abf480c86f162ff405daf91', name: 'Dr S3 Reviewer', profileImage: 'reviews/reviewer1.jpg', isActive: true, courseId: 'unani', displayOrder: 1 },
      ],
    }),
  });
  t.after(() => { UnaniReview.find = origFind; });

  const publicReviews = await unaniReviewService.getPublicReviews();
  assert.equal(publicReviews.length, 1);
  assert.match(publicReviews[0].profileImage, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
});
