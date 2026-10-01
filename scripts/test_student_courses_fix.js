require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const User = require('../models/User');
const Student = require('../models/Student');
const { getJwtSecret } = require('../middleware/rbac');

let server;
const PORT = 5599;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== VERIFYING /api/student/courses FIX ===');
  await connectDB();

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  try {
    const students = await User.find({ role: 'student' }).limit(5);
    console.log(`Found ${students.length} student users in database for testing.`);

    for (const user of students) {
      console.log(`\nTesting for student: ${user.email} (User ID: ${user._id})`);
      const studentDoc = await Student.findOne({ email: user.email.toLowerCase() });

      const secret = getJwtSecret();
      const token = jwt.sign(
        {
          id: user._id.toString(),
          userId: user._id.toString(),
          studentId: studentDoc ? studentDoc._id.toString() : user._id.toString(),
          email: user.email,
          role: 'student',
        },
        secret,
        { expiresIn: '1d' }
      );

      // Test GET /api/student/courses
      const res1 = await request('/api/student/courses', {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`  GET /api/student/courses -> Status: ${res1.status}, Success: ${res1.body?.success}`);
      if (res1.status !== 200 || !res1.body?.success) {
        console.error('  ❌ FAILED response:', res1.body);
        process.exit(1);
      } else {
        console.log(`  ✅ Courses returned: ${res1.body?.count || (Array.isArray(res1.body?.data) ? res1.body.data.length : 0)}`);
      }

      // Test GET /api/students/profile
      const res2 = await request('/api/students/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`  GET /api/students/profile -> Status: ${res2.status}, Success: ${res2.body?.success}`);
      if (res2.status !== 200 || !res2.body?.success) {
        console.error('  ❌ FAILED response:', res2.body);
        process.exit(1);
      }
    }

    console.log('\n🎉 ALL STUDENT COURSES & PROFILE VERIFICATION TESTS PASSED!');
    server.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Test execution error:', err);
    if (server) server.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

runTests();
