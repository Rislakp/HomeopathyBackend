require('dotenv').config();
const { uploadBufferToCloudinary, cloudinary } = require('../config/cloudinary');
const https = require('https');

async function test() {
  const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Test Cloudinary Auto PDF) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF';
  const file = {
    originalname: 'test_sample_note.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(pdfContent),
  };

  console.log('Testing uploadBufferToCloudinary with resource_type: "auto"...');
  const result = await uploadBufferToCloudinary(file, 'homeopathy-media/pdf-notes', {
    resource_type: 'auto',
    public_id: `test_auto_pdf_${Date.now()}`,
  });

  console.log('Upload result:');
  console.log('public_id:', result.public_id);
  console.log('resource_type:', result.resource_type);
  console.log('format:', result.format);
  console.log('secure_url:', result.secure_url);

  // Check if URL is accessible via HTTPS GET
  console.log('Checking URL accessibility...');
  await new Promise((resolve) => {
    https.get(result.secure_url, (res) => {
      console.log('HTTP status code:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      console.log('Content-Length:', res.headers['content-length']);
      res.resume();
      resolve();
    }).on('error', (err) => {
      console.error('HTTP request error:', err.message);
      resolve();
    });
  });

  // Cleanup
  console.log('Cleaning up asset...');
  await cloudinary.uploader.destroy(result.public_id, { resource_type: result.resource_type });
  console.log('Cleanup complete.');
}

test().catch(console.error);
