require('dotenv').config();
const { cloudinary } = require('../config/cloudinary');
const https = require('https');

async function testFetchAuth() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Auth Download) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';

  const uploadRes = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'homeopathy-media/test' },
      (err, res) => err ? reject(err) : resolve(res)
    ).end(Buffer.from(pdfContent));
  });

  console.log('Upload secure_url:', uploadRes.secure_url);
  console.log('Public id:', uploadRes.public_id);

  // Attempt 1: Basic auth with API key and secret on res.cloudinary.com
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  await new Promise((resolve) => {
    https.get(uploadRes.secure_url, { headers: { Authorization: authHeader } }, (res) => {
      console.log('Attempt 1 (Basic auth) status:', res.statusCode, res.headers['x-cld-error']);
      res.resume();
      resolve();
    });
  });

  // Attempt 2: Private download url with correct format and type
  const privUrl = cloudinary.utils.private_download_url(uploadRes.public_id, 'pdf', {
    resource_type: 'image',
    type: 'upload',
  });
  console.log('privUrl:', privUrl);
  await new Promise((resolve) => {
    https.get(privUrl, (res) => {
      console.log('Attempt 2 (private_download_url) status:', res.statusCode, res.headers['x-cld-error']);
      res.resume();
      resolve();
    });
  });

  // Cleanup
  await cloudinary.uploader.destroy(uploadRes.public_id, { resource_type: uploadRes.resource_type });
  console.log('Cleaned up');
}

testFetchAuth().catch(console.error);
