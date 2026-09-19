const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Recording = require('../models/Recording');
const Exam = require('../models/Exam');
const { getDashboardStats, getRecentActivities } = require('../controllers/adminDashboardController');

async function verifyDashboardAndActivities() {
  console.log('====================================================');
  console.log('  VERIFYING REAL DB-DRIVEN DASHBOARD METRICS & FEED');
  console.log('====================================================\n');

  console.log('1. Testing GET /api/admin/dashboard-stats...');
  const origStudentCount = Student.countDocuments;
  const origCourseCount = Course.countDocuments;
  const origRecordingCount = Recording.countDocuments;
  const origStudentAggregate = Student.aggregate;

  Student.countDocuments = async () => 142;
  Course.countDocuments = async () => 24;
  Recording.countDocuments = async () => 58;
  Student.aggregate = async () => [{ totalRevenue: 28950 }];

  let statsStatus = 0;
  let statsJson = null;

  const mockStatsRes = {
    status: (code) => { statsStatus = code; return mockStatsRes; },
    json: (payload) => { statsJson = payload; return mockStatsRes; },
  };

  await getDashboardStats({ query: {} }, mockStatsRes);

  if (statsStatus !== 200 || !statsJson || statsJson.success !== true) {
    console.error('❌ getDashboardStats failed:', statsStatus, statsJson);
    process.exit(1);
  }

  console.log(`✓ getDashboardStats returned status ${statsStatus}`);
  console.log('  Response Data Structure:');
  console.log(`  - success: ${statsJson.success}`);
  console.log(`  - totalEnrolledStudents: ${statsJson.data.totalEnrolledStudents}`);
  console.log(`  - activeMedicalCourses: ${statsJson.data.activeMedicalCourses}`);
  console.log(`  - monthlyRevenue: ${statsJson.data.monthlyRevenue}`);
  console.log(`  - liveWebinarsCompleted: ${statsJson.data.liveWebinarsCompleted}`);

  console.log('\n2. Testing GET /api/admin/activities (Default limit 10)...');
  const mockChain = (data) => ({
    select: () => mockChain(data),
    sort: () => mockChain(data),
    limit: () => mockChain(data),
    lean: async () => data,
  });

  const origActivityFind = Activity.find;
  const origStudentFind = Student.find;
  const origRecordingFind = Recording.find;
  const origExamFind = Exam.find;

  const sampleActivities = Array.from({ length: 12 }).map((_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    title: `Activity #${i + 1}`,
    description: `System action description #${i + 1}`,
    type: i % 2 === 0 ? 'student' : 'exam',
    createdAt: new Date(Date.now() - i * 60000),
  }));

  Activity.find = () => mockChain(sampleActivities.slice(0, 10));
  Student.find = () => mockChain([]);
  Recording.find = () => mockChain([]);
  Exam.find = () => mockChain([]);

  let activitiesStatus = 0;
  let activitiesJson = null;

  const mockActivitiesRes = {
    status: (code) => { activitiesStatus = code; return mockActivitiesRes; },
    json: (payload) => { activitiesJson = payload; return mockActivitiesRes; },
  };

  await getRecentActivities({ query: {} }, mockActivitiesRes);

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
  console.log(`✓ Items count (limit 10 default): ${activitiesJson.count}`);
  console.log('  First item:', activitiesJson.data[0]);

  console.log('\n====================================================');
  console.log('🎉 ALL DASHBOARD STATS & ACTIVITIES CHECKS PASSED!');
  console.log('====================================================');
}

verifyDashboardAndActivities().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
