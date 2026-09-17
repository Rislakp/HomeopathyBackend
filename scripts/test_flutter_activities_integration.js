const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const server = require('../server');
const { getRecentActivities } = require('../controllers/adminDashboardController');

const PORT = 5059;

async function runTests() {
  console.log('====================================================');
  console.log('STARTING FLUTTER ACTIVITIES INTEGRATION TEST');
  console.log('====================================================');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/homeopathy_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');
  }

  const token = jwt.sign(
    { id: new mongoose.Types.ObjectId().toString(), role: 'admin' },
    process.env.JWT_SECRET || 'fallbacksecret',
    { expiresIn: '1h' }
  );

  const req = {
    query: { limit: 10 },
    user: { role: 'admin' },
    headers: { authorization: `Bearer ${token}` }
  };

  let responseData = null;
  let responseStatusCode = null;

  const res = {
    status: function (code) {
      responseStatusCode = code;
      return this;
    },
    json: function (payload) {
      responseStatusCode = responseStatusCode || 200;
      responseData = payload;
      return this;
    }
  };

  await getRecentActivities(req, res);

  console.log('API Status Code:', responseStatusCode);
  console.log('Raw JSON Response Payload:', JSON.stringify(responseData, null, 2));

  if (responseStatusCode !== 200 || !responseData.success) {
    console.error('❌ RECENT ACTIVITIES TEST FAILED!');
    process.exit(1);
  }

  const activitiesList = responseData.data || responseData.activities || [];
  console.log(`Successfully retrieved ${activitiesList.length} activity items.`);

  if (activitiesList.length > 0) {
    const sample = activitiesList[0];
    console.log('Sample Activity Item Structure:');
    console.log('  - id:', sample.id || sample._id);
    console.log('  - title:', sample.title);
    console.log('  - description:', sample.description);
    console.log('  - type:', sample.type);
    console.log('  - createdAt:', sample.createdAt || sample.timestamp);
    console.log('  - timeAgo:', sample.timeAgo);
  }

  console.log('✅ FLUTTER ACTIVITIES INTEGRATION TEST PASSED CLEANLY!');
  console.log('====================================================');

  await mongoose.disconnect();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Unhandled error in activities integration test:', err);
  process.exit(1);
});
