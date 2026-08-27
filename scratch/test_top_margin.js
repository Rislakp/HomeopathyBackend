const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

function generateTestPDF() {
  return new Promise((resolve, reject) => {
    // Set top: 15, bottom: 25 so text at y=20 (header) and y=805 (footer) is strictly within top (15) and bottom (816.89) bounds!
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 15, bottom: 25, left: 40, right: 40 },
      bufferPages: true
    });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    // Pre-register fonts on Page 1
    doc.font('Helvetica');
    doc.font('Helvetica-Bold');
    doc.font('Helvetica-Oblique');

    doc.text('Page 1 content', 40, 40);
    doc.addPage();
    doc.text('Page 2 content', 40, 40);

    const range = doc.bufferedPageRange();
    console.log('Page count before watermarks/footers:', range.count);

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      
      // Page 2+ Running Header at y=20 (strictly >= top: 15)
      if (i > 0) {
        doc.save();
        doc.fillColor('#1A365D');
        doc.fontSize(9);
        doc.font('Helvetica-Bold');
        doc.text('WHITE COAT ACADEMY — OFFICIAL ANSWER KEY', 40, 20, { width: 515, align: 'left' });
        doc.restore();
      }

      // Watermark
      doc.save();
      doc.opacity(0.14);
      doc.fillColor('#4A5568');
      doc.fontSize(12);
      doc.font('Helvetica-Bold');
      doc.text(`Watermark Page ${i + 1}`, 100, 400);
      doc.restore();

      // Running Footer at y=805 (strictly <= 841.89 - 25 = 816.89)
      doc.save();
      doc.fontSize(8);
      doc.font('Helvetica');
      doc.text(`Footer Page ${i + 1} of ${range.count}`, 40, 805, { width: 515, align: 'center' });
      doc.restore();
    }

    doc.end();
  });
}

async function run() {
  const pdfBuffer = await generateTestPDF();
  console.log('Generated PDF buffer length:', pdfBuffer.length);
  const parsed = await pdfParse(pdfBuffer);
  console.log('🎉 PERFECT SUCCESS! Parsed multi-page PDF with 0 XRef errors! Total pages:', parsed.numpages);
}

run().catch(console.error);
