const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https');
require('dotenv').config();

function request(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function testProd() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const admin = await User.findOne({ role: 'admin' }).lean();
  const token = jwt.sign({
    id: admin._id.toString(),
    _id: admin._id.toString(),
    userId: admin._id.toString(),
    role: admin.role || 'admin',
    email: admin.email
  }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const testUrls = [
    'https://api.whitecoat.academy/uploads/ASST PHARMACY (1).pdf',
    'https://homeopathybackend-1.onrender.com/uploads/Pharmacy OCT 6.pdf',
    'https://api.whitecoat.academy/uploads/Pharmacy OCT 6.docx.pdf',
    'https://api.whitecoat.academy/uploads/SAMPLE%20QUESTION%20-%20RESPIRATORY.pdf'
  ];

  for (const u of testUrls) {
    const apiUrl = 'https://api.whitecoat.academy/api/s3-upload/media/access-url?s3Key=' + encodeURIComponent(u);
    const res = await request(apiUrl, token);
    console.log('Tested:', u);
    console.log('Status:', res.status);
    console.log('Body:', res.body);
    console.log('---');
  }

  await mongoose.disconnect();
}
testProd().catch(console.error);
