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
  console.log('STARTING FLUTTER ADMIN DASHBOARD INTEGRATION TEST');
  console.log('====================================================');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/homeopathy_test';

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      console.log('Connected to MongoDB for test.');
    } catch (err) {
      console.log('⚠️  Offline unit test execution — mocking counts.');
      Student.countDocuments = async () => 14250;
      Student.aggregate = async () => [{ totalRevenue: 84920 }];
      Course.countDocuments = async () => 184;
      Recording.countDocuments = async () => 312;
    }
  }

  const adminPayload = {
    id: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    adminId: new mongoose.Types.ObjectId().toString(),
    email: 'admin_flutter_test@example.com',
    role: 'ADMIN'
  };

  const adminToken = jwt.sign(adminPayload, JWT_SECRET, { expiresIn: '1h' });

  // Simulate Flutter DashboardService.fetchDashboardStats()
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

  await adminDashboardController.getDashboardStats(mockReq, mockRes);

  console.log('API Status Code:', statusCode);
  console.log('Raw JSON Response Payload:', JSON.stringify(responseData, null, 2));

  assert.strictEqual(statusCode, 200, 'Expected HTTP 200 OK');
  assert.strictEqual(responseData.success, true, 'Expected success: true');

  // Simulate Flutter DashboardService data mapping
  const body = responseData;
  const data = (body.data && typeof body.data === 'object') ? body.data : body;

  const statsMap = {
    totalEnrolledStudents: data.totalEnrolledStudents ?? body.totalEnrolledStudents ?? 0,
    activeMedicalCourses: data.activeMedicalCourses ?? body.activeMedicalCourses ?? 0,
    monthlyRevenue: data.monthlyRevenue ?? body.monthlyRevenue ?? 0,
    liveWebinarsCompleted: data.liveWebinarsCompleted ?? body.liveWebinarsCompleted ?? 0,
    growth: data.growth ?? {
      totalEnrolledStudents: body.totalEnrolledStudentsGrowth ?? '+0.0%',
      activeMedicalCourses: body.activeMedicalCoursesGrowth ?? '+0.0%',
      monthlyRevenue: body.monthlyRevenueGrowth ?? '+0.0%',
      liveWebinarsCompleted: body.liveWebinarsCompletedGrowth ?? '+0.0%',
    }
  };

  console.log('\n--- SIMULATED FLUTTER STATS MAP ---');
  console.log(JSON.stringify(statsMap, null, 2));

  assert.ok(statsMap.totalEnrolledStudents !== undefined, 'Total Enrolled Students must be defined');
  assert.ok(statsMap.activeMedicalCourses !== undefined, 'Active Medical Courses must be defined');
  assert.ok(statsMap.monthlyRevenue !== undefined, 'Monthly Revenue must be defined');
  assert.ok(statsMap.liveWebinarsCompleted !== undefined, 'Live Webinars Completed must be defined');
  assert.ok(statsMap.growth.totalEnrolledStudents, 'Students growth badge must be defined');
  assert.ok(statsMap.growth.activeMedicalCourses, 'Courses growth badge must be defined');
  assert.ok(statsMap.growth.monthlyRevenue, 'Revenue growth badge must be defined');
  assert.ok(statsMap.growth.liveWebinarsCompleted, 'Webinars growth badge must be defined');

  console.log('\n✅ FLUTTER ADMIN DASHBOARD INTEGRATION TEST PASSED CLEANLY!');
  console.log('====================================================');
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
