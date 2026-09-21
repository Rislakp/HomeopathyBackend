require('dotenv').config();
const { cloudinary } = require('../config/cloudinary');
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

async function testSign() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Cloudinary Auto PDF) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';
  
  const uploadRes = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'homeopathy-media/test' },
      (err, res) => err ? reject(err) : resolve(res)
    ).end(Buffer.from(pdfContent));
  });

  console.log('Upload:', uploadRes.public_id, uploadRes.resource_type, uploadRes.secure_url);

  // Signed URL test
  const signedUrl = cloudinary.url(uploadRes.public_id, {
    resource_type: uploadRes.resource_type,
    format: 'pdf',
    sign_url: true,
    secure: true,
  });

  console.log('Signed URL:', signedUrl);
  const rSigned = await getUrl(signedUrl);
  console.log('Signed Status:', rSigned.statusCode, rSigned.headers['x-cld-error'] || 'OK');

  // Also check if account settings can be fetched
  try {
    const ping = await cloudinary.api.ping();
    console.log('API ping:', ping);
  } catch (e) {
    console.log('API ping error:', e.message);
  }

  // Cleanup
  await cloudinary.uploader.destroy(uploadRes.public_id, { resource_type: uploadRes.resource_type });
}

testSign().catch(console.error);
