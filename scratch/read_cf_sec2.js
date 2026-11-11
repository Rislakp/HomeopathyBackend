const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/hoemopathy/backend/utils/cloudFrontSecurity.js', 'utf8');
const lines = content.split('\n');
for (let i = 60; i < Math.min(lines.length, 160); i++) {
  console.log((i+1) + ': ' + lines[i]);
}

