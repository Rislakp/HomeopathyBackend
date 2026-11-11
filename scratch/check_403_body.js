const https = require('https');

https.get('https://media.whitecoat.academy/videos/1792902657064-bdf23c77-0a88-4a38-bee9-20e63d706f9f-pharmacy-5.mp4', (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('Body:', body);
  });
});

