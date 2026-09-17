const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

const adminDashboardController = require('../controllers/adminDashboardController');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Recording = require('../models/Recording');

async function runTests() {
  console.log('====================================================');
  console.log('STARTING ADMIN DASHBOARD STATS API VERIFICATION');
  console.log('====================================================');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy_test';

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      console.log('Connected to MongoDB for live aggregation test.');
    } catch (err) {
      console.log('⚠️  MongoDB server not connected locally — mocking model counts for offline unit test execution.');
      Student.countDocuments = async () => 1250;
      Student.aggregate = async () => [{ totalRevenue: 154500 }];
      Course.countDocuments = async () => 42;
      Recording.countDocuments = async () => 128;
    }
  }

  // Generate test Admin JWT token
  const adminPayload = {
    id: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    adminId: new mongoose.Types.ObjectId().toString(),
    email: 'admin_dashboard_test@example.com',
    role: 'ADMIN'
  };

  const adminToken = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '1h' });
  console.log('Generated Test Admin Token:', adminToken.slice(0, 20) + '...');

  console.log('\n--- TEST 1: Direct Controller Call for getDashboardStats ---');
  const mockReq = {
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

  await adminDashboardController.getDashboardStats(mockReq, mockRes);

  console.log('Response Status:', statusCode);
  console.log('Response Body:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 200, 'Expected HTTP 200 status code');
  assert.strictEqual(responseData.success, true, 'Expected success: true');
  assert.ok(responseData.data, 'Expected data object in response');

  // Verify specific metric fields in response
  const metrics = responseData.data;

  assert.strictEqual(typeof metrics.totalEnrolledStudents, 'number', 'Expected totalEnrolledStudents to be a number');
  assert.strictEqual(typeof metrics.activeMedicalCourses, 'number', 'Expected activeMedicalCourses to be a number');
  assert.strictEqual(typeof metrics.monthlyRevenue, 'number', 'Expected monthlyRevenue to be a number');
  assert.strictEqual(typeof metrics.liveWebinarsCompleted, 'number', 'Expected liveWebinarsCompleted to be a number');

  // Verify growth indicators
  assert.ok(metrics.growth, 'Expected growth object in metrics');
  assert.strictEqual(typeof metrics.growth.totalEnrolledStudents, 'string', 'Expected totalEnrolledStudents growth string');
  assert.strictEqual(typeof metrics.growth.activeMedicalCourses, 'string', 'Expected activeMedicalCourses growth string');
  assert.strictEqual(typeof metrics.growth.monthlyRevenue, 'string', 'Expected monthlyRevenue growth string');
  assert.strictEqual(typeof metrics.growth.liveWebinarsCompleted, 'string', 'Expected liveWebinarsCompleted growth string');

  // Verify root-level convenience fields
  assert.strictEqual(typeof responseData.totalEnrolledStudents, 'number', 'Expected root totalEnrolledStudents');
  assert.strictEqual(typeof responseData.activeMedicalCourses, 'number', 'Expected root activeMedicalCourses');
  assert.strictEqual(typeof responseData.monthlyRevenue, 'number', 'Expected root monthlyRevenue');
  assert.strictEqual(typeof responseData.liveWebinarsCompleted, 'number', 'Expected root liveWebinarsCompleted');
  assert.strictEqual(typeof responseData.totalEnrolledStudentsGrowth, 'string', 'Expected root totalEnrolledStudentsGrowth');

  console.log('\n✅ ALL DASHBOARD STATS METRICS VALIDATED SUCCESSFULLY:');
  console.log(`  - totalEnrolledStudents  : ${metrics.totalEnrolledStudents} (${metrics.growth.totalEnrolledStudents})`);
  console.log(`  - activeMedicalCourses   : ${metrics.activeMedicalCourses} (${metrics.growth.activeMedicalCourses})`);
  console.log(`  - monthlyRevenue         : ₹${metrics.monthlyRevenue} (${metrics.growth.monthlyRevenue})`);
  console.log(`  - liveWebinarsCompleted  : ${metrics.liveWebinarsCompleted} (${metrics.growth.liveWebinarsCompleted})`);

  console.log('\n====================================================');
  console.log('ADMIN DASHBOARD STATS VERIFICATION COMPLETED CLEANLY');
  console.log('====================================================');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
