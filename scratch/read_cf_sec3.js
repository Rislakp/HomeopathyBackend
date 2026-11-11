const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/hoemopathy/backend/utils/cloudFrontSecurity.js', 'utf8');
const lines = content.split('\n');
for (let i = 160; i < lines.length; i++) {
  console.log((i+1) + ': ' + lines[i]);
}

