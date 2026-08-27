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

    doc.font('Helvetica-Bold').fontSize(14).text('Page 1 content');
    doc.addPage();
    doc.font('Helvetica').fontSize(12).text('Page 2 content');

    const range = doc.bufferedPageRange();
    console.log('Page count before watermarks/footers:', range.count);

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      
      // Watermark (without calling doc.font inside switchToPage)
      doc.save();
      doc.opacity(0.14);
      doc.fillColor('#4A5568');
      doc.fontSize(13);
      doc.text(`WHITE COAT ACADEMY • WATERMARK ${i + 1}`, 100, 400, { lineBreak: false });
      doc.restore();

      // Footer (without calling doc.font inside switchToPage)
      doc.save();
      doc.opacity(0.75);
      doc.fillColor('#718096');
      doc.fontSize(8);
      doc.text(`White Coat Academy — Confidential Answer Key | Page ${i + 1} of ${range.count}`, 40, 800, { lineBreak: false, width: 515, align: 'center' });
      doc.restore();
    }

    doc.end();
  });
}

async function run() {
  const pdfBuffer = await generateTestPDF();
  console.log('Generated PDF buffer length:', pdfBuffer.length);
  const parsed = await pdfParse(pdfBuffer);
  console.log('🎉 SUCCESS! Parsed PDF cleanly! Total pages:', parsed.numpages);
}

run().catch(console.error);
