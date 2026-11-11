const fs = require('fs');
require('dotenv').config();

const envKeys = Object.keys(process.env).filter(k => k.includes('CLOUDFRONT') || k.includes('KEY_PAIR') || k.includes('SIGN'));
console.log('Relevant env vars:');
for (const k of envKeys) {
  const val = process.env[k];
  console.log(`${k}: present=${Boolean(val)}, length=${val ? val.length : 0}`);
}

