const assert = require('assert');
const { sanitizeDocumentUrl, convertRawToImageDelivery } = require('../src/common/documentViewerUtils');

function testUrlSanitizer() {
  console.log('--- Testing DocumentViewerUtils ---');

  // Test 1: Raw Cloudinary URL gets fl_attachment injected
  const rawUrl = 'https://res.cloudinary.com/vadgpisw/raw/upload/v1789981426/homeopathy-media/pdf-notes/notes.pdf';
  const sanitized = sanitizeDocumentUrl(rawUrl);
  console.log('Original:', rawUrl);
  console.log('Sanitized:', sanitized);
  assert.strictEqual(sanitized, 'https://res.cloudinary.com/vadgpisw/raw/upload/fl_attachment/v1789981426/homeopathy-media/pdf-notes/notes.pdf');
  console.log('✔ Test 1 Passed: fl_attachment injected into /raw/upload/');

  // Test 2: Already transformed URL is not duplicated
  const alreadyTransformed = 'https://res.cloudinary.com/vadgpisw/raw/upload/fl_attachment/v1789981426/homeopathy-media/pdf-notes/notes.pdf';
  assert.strictEqual(sanitizeDocumentUrl(alreadyTransformed), alreadyTransformed);
  console.log('✔ Test 2 Passed: No duplicate flag injection');

  // Test 3: Non-cloudinary URL unchanged
  const s3Url = 'https://s3.amazonaws.com/my-bucket/doc.pdf';
  assert.strictEqual(sanitizeDocumentUrl(s3Url), s3Url);
  console.log('✔ Test 3 Passed: External URL preserved');

  // Test 4: Convert raw to image delivery path
  const imageDelivery = convertRawToImageDelivery(rawUrl);
  assert.strictEqual(imageDelivery, 'https://res.cloudinary.com/vadgpisw/image/upload/v1789981426/homeopathy-media/pdf-notes/notes.pdf');
  console.log('✔ Test 4 Passed: Raw to image delivery path conversion');

  console.log('\n🎉 ALL DOCUMENT VIEWER UTILS TESTS PASSED!');
}

testUrlSanitizer();
