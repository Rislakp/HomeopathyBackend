const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/hoemopathy/backend/controllers/s3UploadController.js', 'utf8');
const lines = content.split('\n');
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const getMediaAccessUrl =')) {
    start = i;
    break;
  }
}
if (start !== -1) {
  for (let i = start + 50; i < Math.min(lines.length, start + 180); i++) {
    console.log((i+1) + ': ' + lines[i]);
  }
}

