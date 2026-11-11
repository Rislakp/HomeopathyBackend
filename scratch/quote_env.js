const fs = require('fs');
let envText = fs.readFileSync('.env', 'utf8');
if (envText.includes('CLOUDFRONT_PRIVATE_KEY=-----BEGIN')) {
  envText = envText.replace('CLOUDFRONT_PRIVATE_KEY=-----BEGIN', 'CLOUDFRONT_PRIVATE_KEY="-----BEGIN');
  envText = envText.replace('-----END PRIVATE KEY-----', '-----END PRIVATE KEY-----"');
  fs.writeFileSync('.env', envText);
  console.log('Successfully quoted CLOUDFRONT_PRIVATE_KEY in .env');
} else {
  console.log('Already quoted or different format');
}

