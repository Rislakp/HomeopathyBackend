const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

function generateTestPDF() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true
    });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    // Track total page count
    let pageCount = 1;

    // Draw header on Page 2+ as soon as page is added!
    doc.on('pageAdded', () => {
      pageCount++;
      doc.save();
      doc.fillColor('#1A365D');
      doc.fontSize(9);
      doc.font('Helvetica-Bold');
      doc.text('WHITE COAT ACADEMY — OFFICIAL ANSWER KEY', 40, 20, { width: 515, align: 'left' });
      doc.restore();

      doc.y = 45; // Reset content start position below header
    });

    doc.font('Helvetica-Bold').fontSize(14).text('Page 1 content');
    doc.addPage();
    doc.font('Helvetica').fontSize(12).text('Page 2 content');

    // Post-processing: Watermark & Footers with total count
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = range.start; i < range.start + totalPages; i++) {
      doc.switchToPage(i);
      
      // Watermark
      doc.save();
      doc.opacity(0.14);
      doc.fillColor('#4A5568');
      doc.fontSize(12);
      doc.font('Helvetica-Bold');
      doc.text(`Watermark Page ${i + 1}`, 100, 400);
      doc.restore();

      // Footer
      doc.save();
      doc.fontSize(8);
      doc.font('Helvetica');
      doc.text(`White Coat Academy | Page ${i + 1} of ${totalPages}`, 40, 800, { width: 515, align: 'center' });
      doc.restore();
    }

    doc.end();
  });
}

async function run() {
  const pdfBuffer = await generateTestPDF();
  console.log('Generated PDF buffer length:', pdfBuffer.length);
  const parsed = await pdfParse(pdfBuffer);
  console.log('🎉 PERFECT SUCCESS! Total pages:', parsed.numpages);
}

run().catch(console.error);
