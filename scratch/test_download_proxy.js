require('dotenv').config();
const { cloudinary } = require('../config/cloudinary');
const https = require('https');

async function testDownloadProxy() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Download Proxy) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';

  const uploadRes = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'homeopathy-media/test' },
      (err, res) => err ? reject(err) : resolve(res)
    ).end(Buffer.from(pdfContent));
  });

  console.log('Secure URL:', uploadRes.secure_url);
  console.log('Public id:', uploadRes.public_id);

  // Now simulate what downloadFile does:
  // 1. First try upstream
  // 2. If 401 or PDF, use private_download_url
  const downloadUrl = cloudinary.utils.private_download_url(uploadRes.public_id, 'pdf', {
    resource_type: uploadRes.resource_type || 'image',
    type: 'upload',
  });

  const streamResult = await new Promise((resolve) => {
    https.get(downloadUrl, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const fullBuffer = Buffer.concat(data);
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          length: fullBuffer.length,
          signature: fullBuffer.slice(0, 5).toString('ascii'),
        });
      });
    });
  });

  console.log('Stream result:', streamResult);
  await cloudinary.uploader.destroy(uploadRes.public_id, { resource_type: uploadRes.resource_type });
}

testDownloadProxy().catch(console.error);
