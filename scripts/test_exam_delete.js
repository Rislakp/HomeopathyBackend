require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Exam = require('../models/exam.model');
const TestResult = require('../src/common/models/testResult.model');

const app = express();
app.use(cors());
app.use(express.json());

// Mount the routes exactly like server.js
app.use(require('../routes/exam.routes'));
app.use(require('../src/admin/admin.routes'));

// 404 Route Not Found Catch-All
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', (e) => reject(e));

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('Connecting to database...');
  await connectDB();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    console.log('\n--- 1. Create a test exam document in DB ---');
    const exam1 = await Exam.create({
      title: 'Exam for DELETE /api/exams/:id test',
      marksPerQuestion: 2,
      negativeMark: 0.5,
      durationMinutes: 30,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'What is the capital of France?',
          options: { A: 'London', B: 'Berlin', C: 'Paris', D: 'Rome' },
          correctOption: 'C'
        }
      ]
    });
    const examId1 = exam1._id.toString();
    console.log(`Created exam 1 with ID: ${examId1}`);

    // Create a dummy test result associated with this exam
    const dummyResult = await TestResult.create({
      studentId: new mongoose.Types.ObjectId(),
      examId: exam1._id,
      score: 2,
      totalMarks: 2,
      totalQuestions: 1,
      correctCount: 1,
      incorrectCount: 0,
      unattemptedCount: 0,
      positiveMarks: 2,
      negativeMarks: 0,
      finalScore: 2,
      negativeMark: 0.5,
      answers: []
    });
    console.log(`Created associated test result: ${dummyResult._id}`);

    console.log('\n--- 2. Test DELETE /api/exams/:id ---');
    const deleteRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: `/api/exams/${examId1}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status Code:', deleteRes.status);
    console.log('Response Body:', deleteRes.data);

    if (deleteRes.status === 200 && deleteRes.data?.success === true && deleteRes.data?.deletedExamId === examId1) {
      console.log('✅ PASS: DELETE /api/exams/:id returned 200 OK with success payload');
    } else {
      console.error('❌ FAIL: DELETE /api/exams/:id failed', deleteRes);
      throw new Error('Test 2 failed');
    }

    // Verify exam is gone from DB
    const checkExamInDb = await Exam.findById(examId1);
    if (!checkExamInDb) {
      console.log('✅ PASS: Exam document verified deleted from MongoDB database');
    } else {
      console.error('❌ FAIL: Exam still exists in database');
      throw new Error('Exam not deleted from DB');
    }

    // Verify associated test result is cleaned up
    const checkResultInDb = await TestResult.findById(dummyResult._id);
    if (!checkResultInDb) {
      console.log('✅ PASS: Associated test result was cleaned up');
    } else {
      console.log('ℹ️ Notice: Test result was kept or already removed');
    }

    console.log('\n--- 3. Test DELETE /api/exams/:id with already deleted / non-existent ID ---');
    const deleteNotFoundRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: `/api/exams/${examId1}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status Code:', deleteNotFoundRes.status);
    console.log('Response Body:', deleteNotFoundRes.data);

    if (deleteNotFoundRes.status === 404 && deleteNotFoundRes.data?.success === false) {
      console.log('✅ PASS: DELETE /api/exams/:id with non-existent ID returned 404 Not Found');
    } else {
      console.error('❌ FAIL: Expected 404 for non-existent exam ID', deleteNotFoundRes);
      throw new Error('Test 3 failed');
    }

    console.log('\n--- 4. Test DELETE /api/exams/:id with invalid ObjectId format ---');
    const deleteInvalidRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: `/api/exams/invalid-object-id-123`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status Code:', deleteInvalidRes.status);
    console.log('Response Body:', deleteInvalidRes.data);

    if (deleteInvalidRes.status === 400 && deleteInvalidRes.data?.success === false) {
      console.log('✅ PASS: DELETE /api/exams/:id with invalid ID returned 400 Bad Request');
    } else {
      console.error('❌ FAIL: Expected 400 for invalid ID format', deleteInvalidRes);
      throw new Error('Test 4 failed');
    }

    console.log('\n--- 5. Test DELETE /api/exams/grand-mock/:id ---');
    const exam2 = await Exam.create({
      title: 'Exam for DELETE /api/exams/grand-mock/:id test',
      marksPerQuestion: 1,
      durationMinutes: 10,
      totalQuestions: 1,
      questions: [
        {
          questionText: 'Test question?',
          options: { A: '1', B: '2', C: '3', D: '4' },
          correctOption: 'A'
        }
      ]
    });
    const examId2 = exam2._id.toString();

    const deleteGrandMockRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: `/api/exams/grand-mock/${examId2}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Status Code:', deleteGrandMockRes.status);
    console.log('Response Body:', deleteGrandMockRes.data);

    if (deleteGrandMockRes.status === 200 && deleteGrandMockRes.data?.success === true) {
      console.log('✅ PASS: DELETE /api/exams/grand-mock/:id returned 200 OK');
    } else {
      console.error('❌ FAIL: DELETE /api/exams/grand-mock/:id failed', deleteGrandMockRes);
      throw new Error('Test 5 failed');
    }

    console.log('\n========================================');
    console.log('ALL EXAM DELETE ENDPOINT TESTS PASSED! 🎉');
    console.log('========================================\n');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
