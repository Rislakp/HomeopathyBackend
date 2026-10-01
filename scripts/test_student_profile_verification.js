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
const PORT = 5588;

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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

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

  console.log('Finding or using student user in Atlas...');
  let user = await User.findOne({ email: 'drassrs@gmail.com' });
  if (!user) {
    user = await User.findOne({ role: 'student' });
  }

  let studentDoc = await Student.findOne({ email: user.email });

  console.log(`Using Student: ${user.email} (User ID: ${user._id}, Student ID: ${studentDoc?._id})`);

  const token = jwt.sign(
    {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: 'student',
      courseId: user.courseId || '',
    },
    getJwtSecret(),
    { expiresIn: '1d' }
  );

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
    console.log('\n--- 1. Testing GET /api/students/profile with Bearer token ---');
    const res1 = await request('/api/students/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    console.log('Response Status:', res1.status);
    console.log('Response Body:', JSON.stringify(res1.data, null, 2));

    assert(res1.status === 200, 'Status is 200');
    assert(res1.data.success === true, 'Success is true');
    assert(Boolean(res1.data._id), `_id is present (${res1.data._id})`);
    assert(Boolean(res1.data.name), `name is present (${res1.data.name})`);
    assert(res1.data.email === user.email, `email is present (${res1.data.email})`);
    assert(res1.data.phone !== undefined, `phone is present (${res1.data.phone})`);
    assert(res1.data.registeredCourseId !== undefined, `registeredCourseId is present (${res1.data.registeredCourseId})`);
    assert(res1.data.subscriptionStatus !== undefined, `subscriptionStatus is present (${res1.data.subscriptionStatus})`);
    assert(Boolean(res1.data.profile?._id), 'profile._id is present in nested profile');
    assert(Boolean(res1.data.data?._id), 'data._id is present in nested data');

    console.log('\n--- 2. Testing GET /api/student/profile with Bearer token ---');
    const res2 = await request('/api/student/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res2.status === 200, 'Status is 200 for /api/student/profile');
    assert(Boolean(res2.data._id), `_id is present (${res2.data._id})`);
    assert(res2.data.email === user.email, `email is present (${res2.data.email})`);
    assert(res2.data.phone !== undefined, `phone is present (${res2.data.phone})`);
    assert(res2.data.registeredCourseId !== undefined, `registeredCourseId is present (${res2.data.registeredCourseId})`);
    assert(res2.data.subscriptionStatus !== undefined, `subscriptionStatus is present (${res2.data.subscriptionStatus})`);

    console.log('\n--- 3. Testing GET /api/v1/students/profile with Bearer token ---');
    const res3 = await request('/api/v1/students/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res3.status === 200, 'Status is 200 for /api/v1/students/profile');
    assert(Boolean(res3.data._id), `_id is present`);

    console.log('\n--- 4. Testing GET /api/v1/student/profile with Bearer token ---');
    const res4 = await request('/api/v1/student/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res4.status === 200, 'Status is 200 for /api/v1/student/profile');
    assert(Boolean(res4.data._id), `_id is present`);

    console.log('\n--- 5. Testing GET /api/students/me with Bearer token ---');
    const res5 = await request('/api/students/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res5.status === 200, 'Status is 200 for /api/students/me');
    assert(Boolean(res5.data._id), `_id is present`);

    console.log('\n--- 6. Testing GET /api/students/self with Bearer token ---');
    const res6 = await request('/api/students/self', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res6.status === 200, 'Status is 200 for /api/students/self');
    assert(Boolean(res6.data._id), `_id is present`);

    console.log('\n--- 7. Testing GET /api/students/profile/:id with Bearer token ---');
    const res7 = await request(`/api/students/profile/${user._id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res7.status === 200, 'Status is 200 for /api/students/profile/:id');
    assert(res7.data.email === user.email, 'Email matches for :id route');

    if (studentDoc) {
      console.log('\n--- 7b. Testing GET /api/students/profile/:studentId (using Student document ID) ---');
      const res7b = await request(`/api/students/profile/${studentDoc._id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });
      assert(res7b.status === 200, 'Status is 200 for lookup by Student._id');
      assert(res7b.data.email === user.email, 'Email matches for Student._id route');
    }

    console.log('\n--- 8. Testing GET /api/students/profile without Bearer token ---');
    const res8 = await request('/api/students/profile');
    assert(res8.status === 401, 'Status is 401 Unauthorized without token');
    assert(res8.data.success === false, 'Success is false');

    console.log('\n--- 9. Testing CORS Preflight OPTIONS /api/students/profile ---');
    const originsToTest = [
      'https://student.whitecoatacademy.com',
      'https://whitecoat.academy',
      'https://student-portal.whitecoat.academy',
      'https://student.whitecodeacademy.com',
      'https://my-student-portal.vercel.app',
      'http://localhost:3000',
    ];

    for (const origin of originsToTest) {
      const resOpt = await request('/api/students/profile', {
        method: 'OPTIONS',
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization, Content-Type',
        }
      });
      assert(resOpt.status === 200, `OPTIONS returns 200 for ${origin}`);
      assert(resOpt.headers['access-control-allow-origin'] === origin, `Access-Control-Allow-Origin header set for ${origin}`);
      assert(resOpt.headers['access-control-allow-credentials'] === 'true', `Access-Control-Allow-Credentials is true for ${origin}`);
    }

    console.log('\n--- 10. Testing CORS on actual GET /api/students/profile ---');
    const res10 = await request('/api/students/profile', {
      method: 'GET',
      headers: {
        'Origin': 'https://student.whitecoatacademy.com',
        'Authorization': `Bearer ${token}`,
      }
    });
    assert(res10.status === 200, 'GET with Origin returns 200');
    assert(res10.headers['access-control-allow-origin'] === 'https://student.whitecoatacademy.com', 'CORS origin header set correctly on GET');

    console.log('\n--- 11. Testing Admin Login strictly public ---');
    const res11 = await request('/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        email: 'invalid@example.com',
        password: 'wrongpassword',
      }
    });
    // Should NOT return 401 Bearer token missing; should return 400 or 401 invalid credentials
    assert(res11.data.message !== 'Authentication required. Bearer token missing.', 'Admin login does not require Bearer token');

  } finally {
    server.close();
    await mongoose.connection.close();
    console.log('Test completed.');
  }

  if (allPassed) {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);
  } else {
    console.error('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test execution error:', err);
  if (server) server.close();
  mongoose.connection.close();
  process.exit(1);
});
