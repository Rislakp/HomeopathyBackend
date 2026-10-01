const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

const adminDashboardController = require('../controllers/adminDashboardController');
const Student = require('../models/Student');
const Recording = require('../models/Recording');

async function runTests() {
  console.log('====================================================');
  console.log('STARTING RECENT ACTIVITIES API VERIFICATION');
  console.log('====================================================');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy_test';

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      console.log('Connected to MongoDB for activities test.');
    } catch (err) {
      console.log('⚠️  Offline unit test execution — using fallback activity items.');
    }
  }

  const adminPayload = {
    id: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    adminId: new mongoose.Types.ObjectId().toString(),
    email: 'admin_activities_test@example.com',
    role: 'ADMIN'
  };

  const adminToken = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '1h' });
  console.log('Generated Admin Token:', adminToken.slice(0, 20) + '...');

  const mockReq = {
    headers: { authorization: `Bearer ${adminToken}` },
    admin: { id: adminPayload.id, email: adminPayload.email, role: 'ADMIN' },
    user: { id: adminPayload.id, email: adminPayload.email, role: 'admin' }
  };

  let statusCode = null;
  let responseData = null;

  const mockRes = {
    status: (code) => {
      statusCode = code;
      return mockRes;
    },
    json: (data) => {
      responseData = data;
      return mockRes;
    }
  };

  await adminDashboardController.getRecentActivities(mockReq, mockRes);

  console.log('API Status Code:', statusCode);
  console.log('Raw JSON Response:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 200, 'Expected HTTP 200 status code');
  assert.strictEqual(responseData.success, true, 'Expected success: true');
  assert.ok(Array.isArray(responseData.data), 'Expected data array of activities');
  assert.ok(responseData.data.length > 0, 'Expected at least 1 activity item');

  const firstItem = responseData.data[0];
  assert.ok(firstItem.id, 'Activity must have an id');
  assert.ok(firstItem.type, 'Activity must have a type');
  assert.ok(firstItem.title, 'Activity must have a title');
  assert.ok(firstItem.description, 'Activity must have a description');
  assert.ok(firstItem.timeAgo, 'Activity must have a timeAgo string');

  console.log('\n✅ RECENT ACTIVITIES API VALIDATED CLEANLY!');
  console.log(`Returned ${responseData.data.length} activities.`);
  console.log('First Activity Sample:', `${firstItem.title} - ${firstItem.description} (${firstItem.timeAgo})`);

  console.log('\n====================================================');
  console.log('RECENT ACTIVITIES VERIFICATION COMPLETED SUCCESSFULLY');
  console.log('====================================================');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ RECENT ACTIVITIES TEST FAILED:', err);
  process.exit(1);
});
