const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const Exam = require('../models/Exam');
const { logActivity } = require('../utils/activityLogger');
const { getDashboardStats, getRecentActivities } = require('../controllers/adminDashboardController');

async function runVerification() {
  console.log('=== Verification 1: Testing Activity Model Schema ===');
  const activityDoc = new Activity({
    title: 'Exam published',
    description: 'Dr. Aris Thorne published Final Pathology Exam',
    type: 'exam',
    adminId: '507f1f77bcf86cd799439011',
  });

  const err = activityDoc.validateSync();
  if (err) {
    console.error('❌ Activity schema validation error:', err);
    process.exit(1);
  }
  console.log('✓ Activity schema validation passed.');

  console.log('\n=== Verification 2: Testing Activity Logger Utility ===');
  const logResInvalid = await logActivity({ title: '', description: '' });
  if (logResInvalid !== null) {
    console.error('❌ Expected logActivity with missing fields to return null.');
    process.exit(1);
  }
  console.log('✓ logActivity returns null for invalid inputs as expected.');

  console.log('\n=== Verification 3: Testing GET /api/admin/dashboard-stats Controller Method ===');
  const mockChain = (data) => ({
    select: () => mockChain(data),
    sort: () => mockChain(data),
    limit: () => mockChain(data),
    lean: async () => data,
  });

  const origStudentCount = Student.countDocuments;
  const origCourseCount = Course.countDocuments;
  const origRecordingCount = Recording.countDocuments;
  const origStudentAggregate = Student.aggregate;

  Student.countDocuments = async () => 125;
  Course.countDocuments = async () => 18;
  Recording.countDocuments = async () => 42;
  Student.aggregate = async () => [{ totalRevenue: 15450 }];

  let statsStatus = 0;
  let statsJson = null;

  const mockStatsRes = {
    status: (code) => {
      statsStatus = code;
      return mockStatsRes;
    },
    json: (payload) => {
      statsJson = payload;
      return mockStatsRes;
    },
  };

  await getDashboardStats({ query: {} }, mockStatsRes);

  if (statsStatus !== 200 || !statsJson || statsJson.success !== true) {
    console.error('❌ getDashboardStats failed:', statsStatus, statsJson);
    process.exit(1);
  }

  console.log(`✓ getDashboardStats returned status ${statsStatus}`);
  console.log('  Data payload metrics:');
  console.log(`  - totalEnrolledStudents: ${statsJson.data.totalEnrolledStudents}`);
  console.log(`  - activeMedicalCourses: ${statsJson.data.activeMedicalCourses}`);
  console.log(`  - monthlyRevenue: ${statsJson.data.monthlyRevenue}`);
  console.log(`  - liveWebinarsCompleted: ${statsJson.data.liveWebinarsCompleted}`);
  console.log(`  - growth object present: ${Boolean(statsJson.data.growth)}`);

  console.log('\n=== Verification 4: Testing GET /api/admin/activities Controller Method ===');
  const origActivityFind = Activity.find;
  const origStudentFind = Student.find;
  const origRecordingFind = Recording.find;
  const origExamFind = Exam.find;

  Activity.find = () => mockChain([
    {
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      title: 'New student registration',
      description: 'Dr. Aris Thorne joined Materia Medica 101',
      type: 'student',
      createdAt: new Date(),
    },
  ]);
  Student.find = () => mockChain([]);
  Recording.find = () => mockChain([]);
  Exam.find = () => mockChain([]);

  let activitiesStatus = 0;
  let activitiesJson = null;

  const mockActivitiesRes = {
    status: (code) => {
      activitiesStatus = code;
      return mockActivitiesRes;
    },
    json: (payload) => {
      activitiesJson = payload;
      return mockActivitiesRes;
    },
  };

  await getRecentActivities({ query: { limit: '15' } }, mockActivitiesRes);

  // Restore functions
  Student.countDocuments = origStudentCount;
  Course.countDocuments = origCourseCount;
  Recording.countDocuments = origRecordingCount;
  Student.aggregate = origStudentAggregate;
  Activity.find = origActivityFind;
  Student.find = origStudentFind;
  Recording.find = origRecordingFind;
  Exam.find = origExamFind;

  if (activitiesStatus !== 200 || !activitiesJson || activitiesJson.success !== true) {
    console.error('❌ getRecentActivities failed:', activitiesStatus, activitiesJson);
    process.exit(1);
  }

  console.log(`✓ getRecentActivities returned status ${activitiesStatus}`);
  console.log(`✓ Activities count: ${activitiesJson.count}`);
  console.log('  Sample activity:', activitiesJson.data[0]);

  console.log('\n🎉 ALL DASHBOARD & ACTIVITIES BACKEND CHECKS PASSED SUCCESSFULLY!');
}

runVerification().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
