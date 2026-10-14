// tests/s3MediaSigner.plusEncoding.test.js
// Node.js test to verify that signS3Reference only percent-encodes literal '+' characters.

const test = require('node:test');
const assert = require('node:assert/strict');

// Manual mock of getSignedUrl for Node's test runner.
const presigner = require('@aws-sdk/s3-request-presigner');
const originalGetSignedUrl = presigner.getSignedUrl;
presigner.getSignedUrl = async () => {
  return (
    'https://whitecoat-media-prod.s3.us-east-1.amazonaws.com/pdfs/example.pdf?' +
    'X-Amz-Algorithm=AWS4-HMAC-SHA256&' +
    'X-Amz-Credential=AKIAEXAMPLE%2F20231010%2Fus-east-1%2Fs3%2Faws4_request&' +
    'X-Amz-Date=20231010T120000Z&' +
    'X-Amz-Expires=900&' +
    'X-Amz-SignedHeaders=host&' +
    'X-Amz-Signature=abc+def%2Bghi%3D&' + // '+' and '%2B' and '=' present
    'X-Amz-Security-Token=token+with+plus%2Fand%3Dequals&' + // '+' '/' '='
    'response-content-type=application/pdf&' +
    'response-content-disposition=inline'
  );
};

const { signS3Reference } = require('../utils/s3MediaSigner');

test('signS3Reference plus-encoding regression', async (t) => {
  const reference = {
    storageProvider: 's3',
    s3Key: 'pdfs/example.pdf',
    contentType: 'application/pdf',
  };
  const signed = await signS3Reference(reference, 'application/pdf');

  // The URL must contain "%2B" where the original '+' characters were.
  assert.ok(signed.url.includes('%2B'), 'URL should contain encoded + as %2B');

  // Ensure we did not double-encode existing percent-encodings.
  assert.ok(signed.url.includes('%2F'), 'URL should contain %2F from token');
  assert.ok(signed.url.includes('%3D'), 'URL should contain %3D from token and signature');

  // Original query parameters should still be present.
  assert.match(signed.url, /response-content-type=application\/pdf/);
  assert.match(signed.url, /response-content-disposition=inline/);

  // No raw '+' should remain in the query string.
  const queryPart = signed.url.split('?')[1];
  assert.equal(queryPart.includes('+'), false, 'Raw plus signs must be removed');
});

// Restore original implementation after tests.
presigner.getSignedUrl = originalGetSignedUrl;
