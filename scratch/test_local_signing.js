const mongoose = require('mongoose');
const { s3Client, bucket, region } = require('../config/s3');
const { resolveProfileImageUrl, signS3Reference, normalizeS3Reference } = require('../utils/s3MediaSigner');

async function testLocal() {
  const defaultCredentials = s3Client.config.credentials;
  s3Client.config.credentials = async () => ({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  });

  const rawUrl = 'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/grand_mock_questions/1791350500726-3d63c815-demo-image-question.png';
  console.log('Testing rawUrl:', rawUrl);

  const norm = normalizeS3Reference(rawUrl);
  console.log('Normalized reference:', norm);

  const signedUrl = await resolveProfileImageUrl(rawUrl);
  console.log('\nResult of resolveProfileImageUrl:');
  console.log(signedUrl);

  const isPresigned = signedUrl.includes('X-Amz-Signature') || signedUrl.includes('X-Amz-Algorithm');
  console.log('\nIs presigned SigV4?', isPresigned);

  s3Client.config.credentials = defaultCredentials;
}

testLocal();
