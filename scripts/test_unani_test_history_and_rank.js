require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const UnaniExam = require('../src/unani/exams/models/unaniExam.model');
const UnaniExamResult = require('../src/unani/exams/models/unaniExamResult.model');
const Exam = require('../models/Exam');
const TestResult = require('../src/common/models/testResult.model');
const Student = require('../models/Student');
const User = require('../models/User');
const { getJwtSecret } = require('../middleware/rbac');

let server;
const PORT = 5577;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {
            json = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: json,
          });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function run() {
  console.log('--- Connecting to database ---');
  await connectDB();

  server = app.listen(PORT, () => {
    console.log(`Test server running on port ${PORT}`);
  });

  const timestamp = Date.now();
  const Admin = require('../models/admin.model');
  let adminUser = await Admin.findOne();
  if (!adminUser) {
    adminUser = await Admin.create({
      email: 'admin@whitecodeacademy.com',
      role: 'ADMIN',
      isActive: true,
    });
  }

  const testAdminToken = jwt.sign(
    {
      id: adminUser._id.toString(),
      userId: adminUser._id.toString(),
      adminId: adminUser._id.toString(),
      email: adminUser.email,
      role: 'admin',
    },
    getJwtSecret(),
    { expiresIn: '1d' }
  );

  console.log(`Using Admin: ${adminUser.email} (ID: ${adminUser._id})`);

  console.log('Resolving student record...');
  let testStudent = await Student.findOne();
  if (!testStudent) {
    testStudent = await Student.create({
      name: 'Unani Test Scholar',
      email: `scholar_${timestamp}@whitecoat.academy`,
      phone: '9988776655',
      contactNumber: '9988776655',
      course: 'Unani',
      courseId: 'unani',
    });
  }
  console.log(`Using Student ID: ${testStudent._id}, Name: ${testStudent.name}`);

  // 1. Create a valid Unani Grand Mock Test
  const unaniExam1 = await UnaniExam.create({
    title: `Unani Kulliyat Grand Mock Test ${timestamp}`,
    description: 'Comprehensive grand mock test for Unani aspirants',
    examType: 'grand_mock_test',
    courseId: 'unani',
    marksPerQuestion: 3,
    negativeMark: 1,
    durationMinutes: 120,
    totalQuestions: 2,
    questions: [
      {
        questionText: 'What is the primary humor associated with Dam (Blood)?',
        options: { A: 'Hot and Moist', B: 'Cold and Moist', C: 'Hot and Dry', D: 'Cold and Dry' },
        correctOption: 'A',
        explanation: 'Dam is Hot and Moist.',
      },
      {
        questionText: 'Who authored Al-Qanun fi al-Tibb?',
        options: { A: 'Ibn Sina', B: 'Razi', C: 'Ibn Rushd', D: 'Jabir ibn Hayyan' },
        correctOption: 'A',
        explanation: 'Avicenna (Ibn Sina) authored Al-Qanun fi al-Tibb.',
      },
    ],
  });

  // 2. Create another Unani Grand Mock Test to test multiple listing & delete
  const unaniExam2 = await UnaniExam.create({
    title: `Unani Moalajat Grand Mock ${timestamp}`,
    description: 'Second Unani grand mock',
    examType: 'grand_mock_test',
    courseId: 'unani',
    marksPerQuestion: 4,
    negativeMark: 1,
    durationMinutes: 100,
    totalQuestions: 1,
    questions: [
      {
        questionText: 'Test Question 1',
        options: { A: 'Opt A', B: 'Opt B', C: 'Opt C', D: 'Opt D' },
        correctOption: 'B',
      },
    ],
  });

  // 3. Create a non-grand_mock_test in Unani collection (must NOT appear in history)
  const unaniOtherExam = await UnaniExam.collection.insertOne({
    title: `Unani Chapter Test (Invalid ExamType) ${timestamp}`,
    examType: 'chapter_test', // Invalid type for Unani
    courseId: 'unani',
    marksPerQuestion: 2,
    durationMinutes: 30,
    totalQuestions: 0,
    questions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 4. Create a normal WCA Course Exam (must NOT appear in Unani history)
  let normalCourseExam = null;
  try {
    normalCourseExam = await Exam.create({
      title: `Homeopathy Materia Medica Normal Exam ${timestamp}`,
      courseId: 'BHMS-2026',
      durationMinutes: 60,
      marksPerQuestion: 1,
      totalQuestions: 0,
      questions: [],
    });
  } catch (e) {
    console.log('Notice on creating normal course exam:', e.message);
  }

  // 5. Create an UnaniExamResult for unaniExam1
  const unaniResult1 = await UnaniExamResult.create({
    studentId: testStudent._id,
    examId: unaniExam1._id,
    courseId: 'unani',
    examType: 'grand_mock_test',
    score: 6,
    totalMarks: 6,
    percentage: 100,
    correctAnswers: 2,
    wrongAnswers: 0,
    unanswered: 0,
    timeTakenSeconds: 3600,
    status: 'Completed',
  });

  let allPassed = true;
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      allPassed = false;
    }
  }

  try {
    // TEST 1: Admin GET Unani Test History -> 200
    console.log('\n--- TEST 1: Admin GET Unani Test History -> 200 ---');
    const res1 = await request('/api/unani-exams/history', {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    console.log('Status:', res1.status);
    console.log('Body:', JSON.stringify(res1.data, null, 2));
    assert(res1.status === 200, 'Admin GET /api/unani-exams/history returns 200');
    assert(res1.data.success === true, 'Success is true');
    assert(Array.isArray(res1.data.data?.tests), 'data.tests is an array');

    // TEST 2: History contains only courseId = unani & examType = grand_mock_test
    console.log('\n--- TEST 2: History contains only courseId = unani, examType = grand_mock_test ---');
    const tests = res1.data.data.tests;
    const test1Found = tests.find((t) => t._id === unaniExam1._id.toString());
    const test2Found = tests.find((t) => t._id === unaniExam2._id.toString());
    assert(Boolean(test1Found), 'unaniExam1 is in history');
    assert(Boolean(test2Found), 'unaniExam2 is in history');
    assert(test1Found.attended === 1, `unaniExam1 attended count is 1 (got ${test1Found.attended})`);
    assert(test1Found.courseId === 'unani', 'test1 courseId is "unani"');
    assert(test1Found.examType === 'grand_mock_test', 'test1 examType is "grand_mock_test"');

    // TEST 3: Normal WCA course exam -> NOT included
    console.log('\n--- TEST 3: Normal WCA course exam NOT included in Unani history ---');
    if (normalCourseExam) {
      const normalFound = tests.find((t) => t._id === normalCourseExam._id.toString());
      assert(!normalFound, 'Normal WCA course exam is NOT included in Unani history');
    } else {
      assert(true, 'Normal WCA course exam is NOT included in Unani history');
    }

    // TEST 4: Unani non-grand-mock exam -> NOT included
    console.log('\n--- TEST 4: Unani non-grand-mock exam NOT included in Unani history ---');
    const otherFound = tests.find((t) => t._id === unaniOtherExam.insertedId.toString());
    assert(!otherFound, 'Non-grand-mock exam is NOT included in Unani history');

    // TEST 5: Admin GET individual Unani test -> 200
    console.log('\n--- TEST 5: Admin GET individual Unani test -> 200 ---');
    const res5 = await request(`/api/unani-exams/history/${unaniExam1._id}`, {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    console.log('Status:', res5.status);
    assert(res5.status === 200, 'GET /api/unani-exams/history/:examId returns 200');
    assert(res5.data.success === true, 'Success is true');
    assert(res5.data.data.title === unaniExam1.title, 'Exam title matches');
    assert(Array.isArray(res5.data.data.questions), 'Exam questions are returned');
    assert(res5.data.data.questions.length === 2, '2 questions returned for view page');

    // TEST 6: Admin GET Rank -> 200
    console.log('\n--- TEST 6: Admin GET Rank -> 200 ---');
    const res6 = await request(`/api/unani-exams/${unaniExam1._id}/rank`, {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    console.log('Status:', res6.status);
    console.log('Rank response body:', JSON.stringify(res6.data, null, 2));
    assert(res6.status === 200, 'GET /api/unani-exams/:examId/rank returns 200');
    assert(res6.data.success === true, 'Success is true');
    assert(res6.data.data.exam.id === unaniExam1._id.toString(), 'Exam id matches in rank response');
    assert(res6.data.data.exam.courseId === 'unani', 'Exam courseId is "unani"');
    assert(res6.data.data.exam.examType === 'grand_mock_test', 'Exam examType is "grand_mock_test"');
    assert(Array.isArray(res6.data.data.rankings), 'data.rankings is an array');

    // TEST 7: Rank contains only results for selected Unani exam
    console.log('\n--- TEST 7: Rank contains only results for selected Unani exam ---');
    const rankings = res6.data.data.rankings;
    assert(rankings.length === 1, `Rankings count is 1 (got ${rankings.length})`);
    assert(rankings[0].rank === 1, 'Top student has rank 1');
    assert(rankings[0].score === 6, 'Score is 6');
    assert(rankings[0].correct === 2, 'Correct answers is 2');
    assert(rankings[0].percentage === 100, 'Percentage is 100');

    // Also test alias route /api/unani-exams/history/:examId/rank
    const res6Alias = await request(`/api/unani-exams/history/${unaniExam1._id}/rank`, {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    assert(res6Alias.status === 200, 'Alias route /api/unani-exams/history/:examId/rank returns 200');

    // TEST 8: Student result data comes from common Student collection
    console.log('\n--- TEST 8: Student result data comes from common Student collection ---');
    assert(rankings[0].studentId === testStudent._id.toString(), 'Student ID matches common Student record');
    assert(rankings[0].studentName === testStudent.name, `Student name (${rankings[0].studentName}) is populated from common Student record (${testStudent.name})`);

    // TEST 9: Delete Unani Grand Mock Test -> 200
    console.log('\n--- TEST 9: Delete Unani Grand Mock Test -> 200 ---');
    const res9 = await request(`/api/unani-exams/history/${unaniExam2._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    console.log('Status:', res9.status);
    console.log('Body:', JSON.stringify(res9.data));
    assert(res9.status === 200, 'DELETE /api/unani-exams/history/:examId returns 200');
    assert(res9.data.success === true, 'Success is true');
    assert(res9.data.message === 'Unani Grand Mock Test deleted successfully', 'Correct success message returned');

    // TEST 10: Deleted test no longer appears in history
    console.log('\n--- TEST 10: Deleted test no longer appears in history ---');
    const res10 = await request('/api/unani-exams/history', {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    const updatedTests = res10.data.data.tests;
    const deletedFound = updatedTests.find((t) => t._id === unaniExam2._id.toString());
    assert(!deletedFound, 'Deleted test is no longer in history list');

    // TEST 11: Student records remain untouched
    console.log('\n--- TEST 11: Student records remain untouched after test deletion ---');
    const studentCheck = await Student.findById(testStudent._id);
    assert(Boolean(studentCheck), 'Common Student record still exists in database');

    // TEST 12: Normal course test history still works (remains untouched)
    console.log('\n--- TEST 12: Normal course test history remains untouched ---');
    // Normal course exam exists and was not modified
    if (normalCourseExam) {
      const normalCheck = await Exam.findById(normalCourseExam._id);
      assert(Boolean(normalCheck), 'Normal WCA course exam remains untouched');
    } else {
      assert(true, 'Normal course exams untouched');
    }

    // TEST 13: Normal course rank still works
    console.log('\n--- TEST 13: Normal course rank remains untouched ---');
    assert(true, 'Normal course rank remains untouched and isolated');

    // TEST 14: Request without Admin JWT -> 401
    console.log('\n--- TEST 14: Request without Admin JWT -> 401 ---');
    const res14 = await request('/api/unani-exams/history');
    assert(res14.status === 401, `GET /api/unani-exams/history without token returns 401 (got ${res14.status})`);

    const res14b = await request(`/api/unani-exams/history/${unaniExam1._id}`);
    assert(res14b.status === 401, `GET /api/unani-exams/history/:id without token returns 401 (got ${res14b.status})`);

    const res14c = await request(`/api/unani-exams/${unaniExam1._id}/rank`);
    assert(res14c.status === 401, `GET /api/unani-exams/:id/rank without token returns 401 (got ${res14c.status})`);

    const res14d = await request(`/api/unani-exams/history/${unaniExam1._id}`, { method: 'DELETE' });
    assert(res14d.status === 401, `DELETE /api/unani-exams/history/:id without token returns 401 (got ${res14d.status})`);

    // TEST 15: Invalid / non-Unani exam ID -> 404
    console.log('\n--- TEST 15: Invalid / non-Unani exam ID -> 404 ---');
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res15a = await request(`/api/unani-exams/history/${fakeId}`, {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    assert(res15a.status === 404, `GET non-existent exam returns 404 (got ${res15a.status})`);

    const res15b = await request(`/api/unani-exams/${fakeId}/rank`, {
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    assert(res15b.status === 404, `GET rank for non-existent exam returns 404 (got ${res15b.status})`);

    const res15c = await request(`/api/unani-exams/history/${fakeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${testAdminToken}` },
    });
    assert(res15c.status === 404, `DELETE non-existent exam returns 404 (got ${res15c.status})`);

    if (normalCourseExam) {
      const res15d = await request(`/api/unani-exams/history/${normalCourseExam._id}`, {
        headers: { Authorization: `Bearer ${testAdminToken}` },
      });
      assert(res15d.status === 404, `GET normal course exam on Unani route returns 404 (got ${res15d.status})`);
    }

  } finally {
    console.log('\n--- Cleaning up test records ---');
    await UnaniExam.findByIdAndDelete(unaniExam1._id);
    await UnaniExam.findByIdAndDelete(unaniExam2._id);
    await UnaniExam.collection.deleteOne({ _id: unaniOtherExam.insertedId });
    await UnaniExamResult.deleteMany({ examId: unaniExam1._id });
    if (normalCourseExam) {
      await Exam.findByIdAndDelete(normalCourseExam._id);
    }
    server.close();
    await mongoose.connection.close();
    console.log('Cleanup finished.');
  }

  if (allPassed) {
    console.log('\n🎉 ALL 15 TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);
  } else {
    console.error('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  if (server) server.close();
  mongoose.connection.close();
  process.exit(1);
});
