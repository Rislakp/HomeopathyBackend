const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/hoemopathy/backend/utils/cloudFrontSecurity.js', 'utf8');
const lines = content.split('\n');
console.log('Total lines in cloudFrontSecurity.js:', lines.length);
for (let i = 0; i < Math.min(lines.length, 60); i++) {
  console.log((i+1) + ': ' + lines[i]);
}

