const fs = require('fs');
const path = require('path');

function inspectPdfPages(fileName) {
  const filePath = path.join(__dirname, fileName);
  const buffer = fs.readFileSync(filePath);
  const contentStr = buffer.toString('binary');
  
  const match = contentStr.match(/\/Count\s+(\d+)/);
  const count = match ? parseInt(match[1], 10) : 'Unknown';
  console.log(`${fileName}: Total Pages = ${count}`);
}

console.log('--- INSPECTING PDF CATALOG PAGE COUNTS ---');
inspectPdfPages('output_2q.pdf');
inspectPdfPages('output_10q.pdf');
inspectPdfPages('output_18q.pdf');
inspectPdfPages('output_25q.pdf');
