require('dotenv').config();
const { cloudinary } = require('../config/cloudinary');
const https = require('https');

async function testPrivateDownload() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Cloudinary Private Download) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';

  const uploadRes = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'homeopathy-media/test' },
      (err, res) => err ? reject(err) : resolve(res)
    ).end(Buffer.from(pdfContent));
  });

  console.log('Uploaded public_id:', uploadRes.public_id, 'format:', uploadRes.format, 'resource_type:', uploadRes.resource_type);

  // Test 1: private_download_url
  try {
    const privUrl = cloudinary.utils.private_download_url(uploadRes.public_id, uploadRes.format, {
      resource_type: uploadRes.resource_type,
    });
    console.log('privUrl:', privUrl);
    await new Promise((resolve) => {
      https.get(privUrl, (res) => {
        console.log('privUrl status:', res.statusCode, 'x-cld-error:', res.headers['x-cld-error']);
        res.resume();
        resolve();
      });
    });
  } catch (e) {
    console.log('privUrl err:', e.message);
  }

  // Test 2: download_archive / download_zip_url
  // Test 3: cloudinary.utils.download_url
  try {
    const downUrl = cloudinary.utils.download_url(uploadRes.public_id, {
      resource_type: uploadRes.resource_type,
      format: uploadRes.format,
    });
    console.log('downUrl:', downUrl);
    await new Promise((resolve) => {
      https.get(downUrl, (res) => {
        console.log('downUrl status:', res.statusCode, 'x-cld-error:', res.headers['x-cld-error']);
        res.resume();
        resolve();
      });
    });
  } catch (e) {
    console.log('downUrl err:', e.message);
  }

  // Cleanup
  await cloudinary.uploader.destroy(uploadRes.public_id, { resource_type: uploadRes.resource_type });
}

testPrivateDownload().catch(console.error);
