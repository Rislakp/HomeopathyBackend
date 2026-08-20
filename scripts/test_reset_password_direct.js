require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const User = require('../models/User');
const authRoutes = require('../routes/authRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const makeRequest = (port, path, method, body) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              body: JSON.parse(responseData),
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              raw: responseData,
            });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

async function runTests() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    'mongodb://localhost:27017/homeopathy';

  console.log('Connecting to Mongo:', mongoUri.replace(/\/\/.*@/, '//***@'));
  await mongoose.connect(mongoUri);

  const server = app.listen(0);
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    const testEmail = `test_pw_reset_${Date.now()}@example.com`;
    const initialPassword = 'InitialPassword123!';
    const newPassword1 = 'UpdatedPassword456!';
    const newPassword2 = 'AnotherPassword789!';

    console.log('\n--- 1. Seed test user ---');
    await User.deleteMany({ email: testEmail });
    const createdUser = await User.create({
      name: 'Password Test Student',
      email: testEmail,
      password: initialPassword,
      role: 'student',
      dateOfBirth: '2000-01-01',
      contactNumber: '9988776655',
      qualification: 'BHMS',
    });
    console.log('User created:', createdUser.email);

    // Verify initial login works
    const initLogin = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testEmail,
      password: initialPassword,
    });
    if (initLogin.status !== 200) throw new Error('Initial login failed: ' + JSON.stringify(initLogin));
    console.log('✅ Initial login verified');

    // Test 1: Missing email
    console.log('\n--- 2. Test missing email ---');
    const res1 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      newPassword: newPassword1,
    });
    if (res1.status !== 400 || res1.body.success !== false) throw new Error('Expected 400 for missing email');
    console.log('✅ Missing email returned 400:', res1.body.message);

    // Test 2: Invalid email format
    console.log('\n--- 3. Test invalid email format ---');
    const res2 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: 'not-an-email',
      newPassword: newPassword1,
    });
    if (res2.status !== 400 || res2.body.success !== false) throw new Error('Expected 400 for invalid email');
    console.log('✅ Invalid email returned 400:', res2.body.message);

    // Test 3: Missing newPassword
    console.log('\n--- 4. Test missing newPassword ---');
    const res3 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: testEmail,
    });
    if (res3.status !== 400 || res3.body.success !== false) throw new Error('Expected 400 for missing password');
    console.log('✅ Missing newPassword returned 400:', res3.body.message);

    // Test 4: Password too short (< 6 chars)
    console.log('\n--- 5. Test short password (< 6 chars) ---');
    const res4 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: testEmail,
      newPassword: '123',
    });
    if (res4.status !== 400 || res4.body.success !== false) throw new Error('Expected 400 for short password');
    console.log('✅ Short password returned 400:', res4.body.message);

    // Test 5: Passwords do not match
    console.log('\n--- 6. Test password mismatch with confirmPassword ---');
    const res5 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: testEmail,
      newPassword: newPassword1,
      confirmPassword: 'DifferentPassword!',
    });
    if (res5.status !== 400 || res5.body.success !== false) throw new Error('Expected 400 for password mismatch');
    console.log('✅ Password mismatch returned 400:', res5.body.message);

    // Test 6: Non-existent user
    console.log('\n--- 7. Test non-existent user ---');
    const res6 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: 'nonexistent_user_99999@example.com',
      newPassword: newPassword1,
      confirmPassword: newPassword1,
    });
    if (res6.status !== 404 || res6.body.success !== false) throw new Error('Expected 404 for non-existent user');
    console.log('✅ Non-existent user returned 404:', res6.body.message);

    // Test 7: Successful direct reset via POST /api/auth/reset-password with confirmPassword
    console.log('\n--- 8. Test successful reset via POST /api/auth/reset-password ---');
    const res7 = await makeRequest(port, '/api/auth/reset-password', 'POST', {
      email: testEmail,
      newPassword: newPassword1,
      confirmPassword: newPassword1,
    });
    if (res7.status !== 200 || res7.body.success !== true) throw new Error('Expected 200 for successful reset: ' + JSON.stringify(res7));
    console.log('✅ Reset password returned 200:', res7.body.message);

    // Verify old password fails login
    const oldLogin = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testEmail,
      password: initialPassword,
    });
    if (oldLogin.status !== 401) throw new Error('Old password should return 401');
    console.log('✅ Old password rejected after reset (401)');

    // Verify new password succeeds login
    const newLogin1 = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testEmail,
      password: newPassword1,
    });
    if (newLogin1.status !== 200) throw new Error('New password login failed');
    console.log('✅ New password login successful (200)');

    // Test 8: Successful direct update via PUT /api/auth/update-password without confirmPassword (optional)
    console.log('\n--- 9. Test successful update via PUT /api/auth/update-password without confirmPassword ---');
    const res8 = await makeRequest(port, '/api/auth/update-password', 'PUT', {
      email: testEmail,
      newPassword: newPassword2,
    });
    if (res8.status !== 200 || res8.body.success !== true) throw new Error('Expected 200 for update without confirmPassword: ' + JSON.stringify(res8));
    console.log('✅ Update password returned 200:', res8.body.message);

    // Verify newPassword2 login succeeds
    const newLogin2 = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testEmail,
      password: newPassword2,
    });
    if (newLogin2.status !== 200) throw new Error('New password 2 login failed');
    console.log('✅ Updated password login successful (200)');

    // Cleanup
    await User.deleteMany({ email: testEmail });
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
