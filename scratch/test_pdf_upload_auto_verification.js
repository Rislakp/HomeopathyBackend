const { uploadBufferToCloudinary, cloudinary } = require('../config/cloudinary');

async function testPdfUpload() {
  console.log('--- Testing PDF Upload with resource_type: auto ---');
  
  // Create a minimal valid PDF buffer
  const samplePdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
72 712 Td
(Test Cloudinary PDF Delivery) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
308
%%EOF`;

  const pdfBuffer = Buffer.from(samplePdf, 'utf-8');
  const mockFile = {
    originalname: 'test-document-upload.pdf',
    mimetype: 'application/pdf',
    buffer: pdfBuffer,
    size: pdfBuffer.length,
  };

  const uploadRes = await uploadBufferToCloudinary(mockFile, 'homeopathy-media/pdf-notes', {
    resource_type: 'auto',
    public_id: `test-doc-${Date.now()}`,
    access_mode: 'public',
  });

  console.log('Upload Result:');
  console.log('  public_id:', uploadRes.public_id);
  console.log('  resource_type:', uploadRes.resource_type);
  console.log('  format:', uploadRes.format);
  console.log('  secure_url:', uploadRes.secure_url);

  console.log('\n--- Testing Public Delivery (HTTP GET) ---');
  try {
    const headRes = await fetch(uploadRes.secure_url);
    console.log(`✅ Success! HTTP Status: ${headRes.status}`);
    console.log(`   Content-Type: ${headRes.headers.get('content-type')}`);
    console.log(`   Content-Length: ${headRes.headers.get('content-length')} bytes`);
  } catch (err) {
    console.error(`❌ Delivery failed:`, err);
  } finally {
    console.log('\n--- Cleaning up test asset ---');
    const deleteRes = await cloudinary.uploader.destroy(uploadRes.public_id, {
      resource_type: uploadRes.resource_type,
    });
    console.log('Clean up result:', deleteRes.result);
  }
}

testPdfUpload().catch(console.error);
