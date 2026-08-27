const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

function generateTestPDF() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 10, left: 40, right: 40 }, // Bottom margin 10 so footer at 810 never exceeds bottom threshold (831.89)
      bufferPages: true
    });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    doc.font('Helvetica');
    doc.font('Helvetica-Bold');
    doc.font('Helvetica-Oblique');

    doc.text('Page 1 content');
    doc.addPage();
    doc.text('Page 2 content');

    const range = doc.bufferedPageRange();
    console.log('Page count before watermarks/footers:', range.count);

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      
      // Watermark
      doc.save();
      doc.opacity(0.14);
      doc.fillColor('#4A5568');
      doc.fontSize(12);
      doc.font('Helvetica-Bold');
      doc.text(`Watermark Page ${i + 1}`, 100, 400, { lineBreak: false });
      doc.restore();

      // Footer - safe at y=810 with bottom margin=10
      doc.save();
      doc.fontSize(8);
      doc.font('Helvetica');
      doc.text(`Footer Page ${i + 1} of ${range.count}`, 40, 810, { lineBreak: false, width: 515, align: 'center' });
      doc.restore();
    }

    doc.end();
  });
}

async function run() {
  const pdfBuffer = await generateTestPDF();
  console.log('Generated PDF buffer length:', pdfBuffer.length);
  const parsed = await pdfParse(pdfBuffer);
  console.log('🎉 SUCCESS! Parsed PDF with 0 XRef errors! Total pages:', parsed.numpages);
}

run().catch(console.error);
