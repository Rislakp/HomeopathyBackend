const assert = require('assert');
const { forgotPassword, resetPassword, updatePassword } = require('../controllers/authController');
const crypto = require('crypto');

// Mock User Model
const mockUser = {
  _id: 'user123',
  email: 'test@example.com',
  password: 'oldpassword123',
  save: async function() { return this; },
  matchPassword: async function(pwd) { return pwd === this.password; }
};

global.User = {
  findOne: async (query) => {
    if (query.email === 'test@example.com') {
      if (query.resetPasswordToken) {
        if (query.resetPasswordToken !== mockUser.resetPasswordToken) return null;
      }
      return mockUser;
    }
    return null;
  },
  findById: async (id) => id === 'user123' ? mockUser : null
};

// Mock response object
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

async function runTests() {
  console.log('Running Security Fixes Tests...\n');
  
  try {
    // Test 1: Generate Recovery Token (forgot-password)
    console.log('Test 1: Generates recovery token successfully');
    const req1 = { body: { email: 'test@example.com' } };
    const res1 = mockRes();
    await forgotPassword(req1, res1);
    assert.strictEqual(res1.statusCode, 200, 'Should return 200');
    assert.ok(mockUser.resetPasswordToken, 'User should have token assigned');
    console.log('✔ Passed');

    // Test 2: Reset password without token is rejected
    console.log('Test 2: Reset password without token is rejected');
    const req2 = { body: { email: 'test@example.com', newPassword: 'newpassword123' } };
    const res2 = mockRes();
    await resetPassword(req2, res2);
    assert.strictEqual(res2.statusCode, 400, 'Should return 400');
    assert.strictEqual(res2.data.message, 'Please provide email and verification token');
    console.log('✔ Passed');

    // Test 3: Invalid token is rejected
    console.log('Test 3: Invalid token is rejected');
    const req3 = { body: { email: 'test@example.com', token: 'invalid_token', newPassword: 'newpassword123' } };
    const res3 = mockRes();
    await resetPassword(req3, res3);
    assert.strictEqual(res3.statusCode, 400, 'Should return 400');
    assert.strictEqual(res3.data.message, 'Invalid or expired recovery token');
    console.log('✔ Passed');

    // Test 4: Valid recovery token completes successfully
    console.log('Test 4: Valid recovery token completes successfully');
    const plainToken = 'valid_token_123';
    const hash = crypto.createHash('sha256').update(plainToken).digest('hex');
    mockUser.resetPasswordToken = hash;
    mockUser.resetPasswordExpire = Date.now() + 10000;

    const req4 = { body: { email: 'test@example.com', token: plainToken, newPassword: 'newpassword123' } };
    const res4 = mockRes();
    await resetPassword(req4, res4);
    assert.strictEqual(res4.statusCode, 200, 'Should return 200');
    assert.strictEqual(mockUser.password, 'newpassword123', 'Password should be updated');
    assert.strictEqual(mockUser.resetPasswordToken, undefined, 'Token should be cleared');
    console.log('✔ Passed');

    // Test 5: Reusing token fails
    console.log('Test 5: Reusing token fails');
    const req5 = { body: { email: 'test@example.com', token: plainToken, newPassword: 'hackerpassword' } };
    const res5 = mockRes();
    await resetPassword(req5, res5);
    assert.strictEqual(res5.statusCode, 400, 'Should return 400');
    assert.strictEqual(res5.data.message, 'Invalid or expired recovery token');
    console.log('✔ Passed');
    
    // Test 6: Authenticated updatePassword works
    console.log('Test 6: Existing authenticated update works');
    const req6 = { 
      user: { id: 'user123' }, 
      body: { oldPassword: 'newpassword123', newPassword: 'finalpassword' }
    };
    const res6 = mockRes();
    await updatePassword(req6, res6);
    assert.strictEqual(res6.statusCode, 200);
    assert.strictEqual(mockUser.password, 'finalpassword');
    console.log('✔ Passed');

    console.log('\nAll Tests Passed!');
  } catch (error) {
    console.error('Test Failed:', error);
    process.exit(1);
  }
}

runTests();
