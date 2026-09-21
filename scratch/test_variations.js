require('dotenv').config();
const { uploadBufferToCloudinary, cloudinary } = require('../config/cloudinary');
const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    }).on('error', err => resolve({ error: err.message }));
  });
}

async function testVariations() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Cloudinary Auto PDF) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';
  
  const file = {
    originalname: 'test_pdf.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(pdfContent),
  };

  const uploadRes = await uploadBufferToCloudinary(file, 'homeopathy-media/test', {
    resource_type: 'auto',
    public_id: `test_var_${Date.now()}`,
  });

  console.log('Original uploadRes:', uploadRes);

  // Variation 1: original secure_url
  console.log('\n--- 1. Original secure_url ---');
  const r1 = await getUrl(uploadRes.secure_url);
  console.log('Status:', r1.statusCode, 'Headers:', r1.headers, 'Body:', r1.body);

  // Variation 2: With .jpg / .png transformation
  const jpgUrl = uploadRes.secure_url.replace(/\.pdf$/, '.jpg');
  console.log('\n--- 2. Transformed to .jpg ---', jpgUrl);
  const r2 = await getUrl(jpgUrl);
  console.log('Status:', r2.statusCode, 'Body length:', r2.body.length);

  // Variation 3: fl_attachment
  const flAttachmentUrl = uploadRes.secure_url.replace('/upload/', '/upload/fl_attachment/');
  console.log('\n--- 3. fl_attachment ---', flAttachmentUrl);
  const r3 = await getUrl(flAttachmentUrl);
  console.log('Status:', r3.statusCode, 'Headers:', r3.headers);

  // Variation 4: raw upload with access_mode: public
  const rawUpload = await uploadBufferToCloudinary(file, 'homeopathy-media/test', {
    resource_type: 'raw',
    access_mode: 'public',
    public_id: `test_raw_${Date.now()}.pdf`,
  });
  console.log('\n--- 4. Raw upload with access_mode: public ---', rawUpload.secure_url);
  const r4 = await getUrl(rawUpload.secure_url);
  console.log('Status:', r4.statusCode, 'Headers:', r4.headers, 'Body:', r4.body);

  // Cleanup
  await cloudinary.uploader.destroy(uploadRes.public_id, { resource_type: uploadRes.resource_type });
  await cloudinary.uploader.destroy(rawUpload.public_id, { resource_type: 'raw' });
  console.log('\nDone.');
}

testVariations().catch(console.error);
