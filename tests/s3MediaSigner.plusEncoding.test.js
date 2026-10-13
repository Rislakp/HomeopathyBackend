// tests/s3MediaSigner.plusEncoding.test.js
// This test verifies that signS3Reference only percent-encodes literal '+' characters
// in the signed URL while leaving all other query parameters untouched.

const { signS3Reference } = require('../utils/s3MediaSigner');

// Mock the AWS SDK presigner to return a URL containing '+' characters in
// the signature and in the temporary security token.
jest.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: jest.fn().mockResolvedValue(
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
    ),
  };
});

describe('signS3Reference plus-encoding regression', () => {
  it('should percent-encode only literal "+" characters', async () => {
    const reference = {
      storageProvider: 's3',
      s3Key: 'pdfs/example.pdf',
      contentType: 'application/pdf',
    };
    const signed = await signS3Reference(reference, 'application/pdf');

    // The URL must contain "%2B" where the original '+' characters were.
    expect(signed.url).toContain('%2B');
    // Ensure we did not double-encode existing percent-encodings.
    expect(signed.url).toContain('%2F'); // from token
    expect(signed.url).toContain('%3D'); // from token and signature
    // Original query parameters should still be present.
    expect(signed.url).toMatch(/response-content-type=application\/pdf/);
    expect(signed.url).toMatch(/response-content-disposition=inline/);
    // No raw '+' should remain in the query string.
    const queryPart = signed.url.split('?')[1];
    expect(queryPart.includes('+')).toBe(false);
  });
});
