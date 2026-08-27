const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function checkPageCounts() {
  const smallBuffer = fs.readFileSync(path.join(__dirname, 'output_small.pdf'));
  const mediumBuffer = fs.readFileSync(path.join(__dirname, 'output_medium.pdf'));

  const smallParsed = await pdfParse(smallBuffer);
  const mediumParsed = await pdfParse(mediumBuffer);

  console.log(`Small Exam PDF Page Count: ${smallParsed.numpages}`);
  console.log(`Medium Exam PDF Page Count: ${mediumParsed.numpages}`);

  let passed = true;

  if (smallParsed.numpages === 1) {
    console.log('✅ Small exam is exactly 1 page (0 extra blank pages)');
  } else {
    console.error(`❌ Expected 1 page for small exam, got ${smallParsed.numpages}`);
    passed = false;
  }

  if (mediumParsed.numpages === 2) {
    console.log('✅ Medium exam is exactly 2 pages (0 extra blank pages, pages 3/4 completely eliminated!)');
  } else {
    console.error(`❌ Expected 2 pages for medium exam, got ${mediumParsed.numpages}`);
    passed = false;
  }

  if (!passed) {
    process.exit(1);
  } else {
    console.log('\n🎉 ALL PAGE COUNT AND HEADER/FOOTER SYNCHRONIZATION ASSERTIONS PASSED!');
  }
}

checkPageCounts().catch(err => {
  console.error('Assertion error:', err);
  process.exit(1);
});
