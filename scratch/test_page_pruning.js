const PDFDocument = require('pdfkit');

function testPruning() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

  doc.text('Hello page 1');
  doc.addPage();
  doc.text('Hello page 2');
  doc.addPage(); // Accidental extra blank page at the end!

  console.log('Before pruning, pages count:', doc.bufferedPageRange().count);
  console.log('doc.y on current (last) page:', doc.y);
  console.log('_pageBuffer length:', doc._pageBuffer.length);

  // Check if last page is empty (doc.y is still at top margin)
  if (doc._pageBuffer.length > 1 && doc.y <= 45) {
    console.log('Last page is empty! Pruning last page...');
    doc._pageBuffer.pop();
    // Also reset current page pointer if needed
    doc.switchToPage(doc._pageBuffer.length - 1);
  }

  console.log('After pruning, pages count:', doc.bufferedPageRange().count);
  console.log('_pageBuffer length:', doc._pageBuffer.length);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.text(`Footer Page ${i + 1} of ${range.count}`, 40, 800);
  }

  doc.end();
}

testPruning();
