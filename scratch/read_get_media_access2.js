const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/hoemopathy/backend/controllers/s3UploadController.js', 'utf8');
const lines = content.split('\n');
for (let i = 930; i < Math.min(lines.length, 1060); i++) {
  console.log((i+1) + ': ' + lines[i]);
}

