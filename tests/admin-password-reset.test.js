const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Mock mongoose connection state for isolated unit testing
// Mock connection readyState after model initialization

// Configure test environment
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test_wca_admin_jwt_secret_key_2026_super_secure';
process.env.JWT_REFRESH_SECRET = 'test_wca_admin_jwt_refresh_secret_key_2026';
process.env.ADMIN_PORTAL_URL = 'https://admin.whitecoat.academy';
process.env.DEMO_ADMIN_EMAIL = 'admin@whitecodeacademy.com';
process.env.RESTRICT_DEMO_ADMIN_PASSWORD_RESET = 'true';

const Admin = require('../models/admin.model');
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
const {
  adminLogin,
  adminForgotPassword,
  adminResetPassword,
} = require('../controllers/adminAuthController');
const emailService = require('../services/emailService');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Helper to construct mock Express request and response objects
const createMockReqRes = (options = {}) => {
  const req = {
    headers: { ...(options.headers || {}) },
    body: { ...(options.body || {}) },
    params: { ...(options.params || {}) },
    query: { ...(options.query || {}) },
    ip: options.ip || '127.0.0.1',
    connection: { remoteAddress: options.ip || '127.0.0.1' },
  };

  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };

  return { req, res };
};

// In-memory test store simulating Admin MongoDB collection
const testAdmins = new Map();

// Helper to seed an admin in the mock store
const seedMockAdmin = async ({
  id = 'admin_001',
  name = 'Dr. Sarah Connor',
  email = 'sarah.connor@whitecoat.academy',
  password = 'InitialPassword@2026',
  role = 'ADMIN',
  isActive = true,
  resetPasswordToken = undefined,
  resetPasswordExpire = undefined,
  tokenVersion = 0,
} = {}) => {
  const passwordHash = password.startsWith('$2')
    ? password
    : await bcrypt.hash(password, 10);

  const doc = {
    _id: id,
    id,
    name,
    email: email.toLowerCase().trim(),
    password: passwordHash,
    role,
    isActive,
    resetPasswordToken,
    resetPasswordExpire,
    tokenVersion,
    save: async function () {
      testAdmins.set(this.email, this);
      return this;
    },
  };

  testAdmins.set(doc.email, doc);
  return doc;
};

// Override Admin model methods to work reliably offline without requiring live MongoDB connection
Admin.findOne = (query) => {
  const execute = async () => {
    const cleanEmail = query.email ? String(query.email).trim().toLowerCase() : null;
    if (!cleanEmail) return null;

    const admin = testAdmins.get(cleanEmail);
    if (!admin) return null;

    if (query.resetPasswordToken && admin.resetPasswordToken !== query.resetPasswordToken) {
      return null;
    }

    return {
      ...admin,
      save: admin.save,
    };
  };

  const p = execute();
  p.lean = () => execute();
  return p;
};



Admin.create = async (data) => {
  return seedMockAdmin(data);
};

Admin.updateOne = async (filter, update) => {
  const admin = await Admin.findOne(filter);
  if (admin && update.$set) {
    Object.assign(admin, update.$set);
    testAdmins.set(admin.email, admin);
  }
  return { acknowledged: true, modifiedCount: admin ? 1 : 0 };
};

Admin.findOneAndUpdate = async (filter, update, options) => {
  let admin = await Admin.findOne(filter);
  if (!admin && options && options.upsert) {
    admin = await seedMockAdmin({ email: filter.email, ...(update.$set || {}) });
  } else if (admin && update.$set) {
    Object.assign(admin, update.$set);
    testAdmins.set(admin.email, admin);
  }
  return admin;
};

// Reset mock store before each test
function resetMockStore() {
  testAdmins.clear();
  emailService.clearSentEmails();
}

test('1. Valid forgot-password request initiates password reset and dispatches email', async () => {
  resetMockStore();
  const admin = await seedMockAdmin({
    email: 'admin.active@whitecoat.academy',
    name: 'Active Administrator',
    password: 'OldSecureAdminPassword@2026',
  });

  const { req, res } = createMockReqRes({
    body: { email: 'admin.active@whitecoat.academy' },
  });

  await adminForgotPassword(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  assert.match(res.data.message, /password reset instructions have been sent/i);

  // Verify that Admin record received a hashed reset token and expiration
  const updatedAdmin = testAdmins.get('admin.active@whitecoat.academy');
  assert.ok(updatedAdmin.resetPasswordToken, 'Reset token hash must be set');
  assert.strictEqual(updatedAdmin.resetPasswordToken.length, 64, 'Token hash must be SHA-256 (64 hex characters)');
  assert.ok(updatedAdmin.resetPasswordExpire instanceof Date, 'Expire must be a valid Date object');
  assert.ok(updatedAdmin.resetPasswordExpire.getTime() > Date.now(), 'Expire must be in the future');

  // Verify email dispatch
  const sentEmails = emailService.getSentEmails();
  assert.strictEqual(sentEmails.length, 1, 'Exactly one password reset email must be sent');
  assert.strictEqual(sentEmails[0].to, 'admin.active@whitecoat.academy');
  assert.ok(sentEmails[0].resetUrl.includes('/reset-password?token='), 'Reset link must contain reset token');

  // Verify plain-text token is NEVER stored in the database
  const sentToken = sentEmails[0].resetToken;
  assert.notStrictEqual(updatedAdmin.resetPasswordToken, sentToken, 'Database must never store plain-text token');
  const expectedHash = crypto.createHash('sha256').update(sentToken).digest('hex');
  assert.strictEqual(updatedAdmin.resetPasswordToken, expectedHash, 'Database must store SHA-256 hash of token');
});

test('2. Invalid email format is rejected with 400 Bad Request', async () => {
  resetMockStore();

  const invalidInputs = [
    '',
    '   ',
    'notanemail',
    'admin@',
    '@domain.com',
    'admin@domain',
    null,
    undefined,
    12345,
  ];

  for (const invalidEmail of invalidInputs) {
    const { req, res } = createMockReqRes({
      body: { email: invalidEmail },
    });

    await adminForgotPassword(req, res);

    assert.strictEqual(res.statusCode, 400, `Expected 400 for input: ${JSON.stringify(invalidEmail)}`);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /valid email address/i);
  }

  // No emails should have been sent
  assert.strictEqual(emailService.getSentEmails().length, 0);
});

test('3. Non-existent email returns generic 200 response (prevents account enumeration)', async () => {
  resetMockStore();

  const { req, res } = createMockReqRes({
    body: { email: 'doesnotexist@whitecoat.academy' },
  });

  await adminForgotPassword(req, res);

  // Must return 200 with generic message, never 404
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  assert.match(res.data.message, /password reset instructions have been sent/i);

  // No email should be sent for a non-existent account
  assert.strictEqual(emailService.getSentEmails().length, 0);
});

test('4. Inactive admin account returns generic 200 response and does not generate token', async () => {
  resetMockStore();
  await seedMockAdmin({
    email: 'inactive.admin@whitecoat.academy',
    isActive: false,
  });

  const { req, res } = createMockReqRes({
    body: { email: 'inactive.admin@whitecoat.academy' },
  });

  await adminForgotPassword(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);

  const adminInDb = testAdmins.get('inactive.admin@whitecoat.academy');
  assert.strictEqual(adminInDb.resetPasswordToken, undefined, 'Inactive admin must not receive reset token');
  assert.strictEqual(emailService.getSentEmails().length, 0);
});

test('5. Demo admin account password reset is restricted by configuration', async () => {
  resetMockStore();
  const demoEmail = 'admin@whitecodeacademy.com';
  await seedMockAdmin({
    email: demoEmail,
    password: 'WhiteCode@Admin2026',
  });

  // Forgot password for demo account returns generic response (no enumeration)
  const { req: reqForgot, res: resForgot } = createMockReqRes({
    body: { email: demoEmail },
  });

  await adminForgotPassword(reqForgot, resForgot);
  assert.strictEqual(resForgot.statusCode, 200);
  assert.strictEqual(emailService.getSentEmails().length, 0, 'No email should be dispatched for protected demo admin');

  // Attempting reset-password on demo account directly returns 403 Forbidden
  const { req: reqReset, res: resReset } = createMockReqRes({
    body: {
      email: demoEmail,
      token: 'some_sample_reset_token_hex_1234567890',
      newPassword: 'AttemptedNewPassword2026!',
      confirmPassword: 'AttemptedNewPassword2026!',
    },
  });

  await adminResetPassword(reqReset, resReset);
  assert.strictEqual(resReset.statusCode, 403);
  assert.strictEqual(resReset.data.success, false);
  assert.match(resReset.data.message, /Password recovery flow is disabled for the demo admin account/i);
});

test('6. Rate limiting blocks repeated forgot-password requests beyond threshold', async () => {
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 3,
    message: 'Too many password reset requests. Please try again later.',
  });

  let nextCalledCount = 0;
  const next = () => { nextCalledCount++; };

  // First 3 requests should succeed
  for (let i = 1; i <= 3; i++) {
    const { req, res } = createMockReqRes({
      ip: '192.168.1.100',
      body: { email: 'rate.limit.test@whitecoat.academy' },
    });
    limiter(req, res, next);
    assert.strictEqual(nextCalledCount, i);
    assert.strictEqual(res.statusCode, 200);
  }

  // 4th request must be rejected with 429
  const { req: req4, res: res4 } = createMockReqRes({
    ip: '192.168.1.100',
    body: { email: 'rate.limit.test@whitecoat.academy' },
  });
  limiter(req4, res4, next);
  assert.strictEqual(res4.statusCode, 429);
  assert.strictEqual(res4.data.success, false);
  assert.match(res4.data.message, /Too many password reset requests/i);
  assert.ok(res4.headers['Retry-After'], 'Retry-After header must be present on 429');

  limiter.destroy();
});

test('7. Reset password validates input parameters (missing fields, short password, mismatch)', async () => {
  resetMockStore();
  const validEmail = 'admin.validation@whitecoat.academy';
  await seedMockAdmin({ email: validEmail });

  // Missing email
  const { req: req1, res: res1 } = createMockReqRes({
    body: { token: 'validtoken123', newPassword: 'ValidPassword123!' },
  });
  await adminResetPassword(req1, res1);
  assert.strictEqual(res1.statusCode, 400);

  // Missing token
  const { req: req2, res: res2 } = createMockReqRes({
    body: { email: validEmail, newPassword: 'ValidPassword123!' },
  });
  await adminResetPassword(req2, res2);
  assert.strictEqual(res2.statusCode, 400);

  // Password too short (< 8 chars)
  const { req: req3, res: res3 } = createMockReqRes({
    body: { email: validEmail, token: 'validtoken123', newPassword: 'short' },
  });
  await adminResetPassword(req3, res3);
  assert.strictEqual(res3.statusCode, 400);
  assert.match(res3.data.message, /at least 8 characters/i);

  // Confirm password mismatch
  const { req: req4, res: res4 } = createMockReqRes({
    body: {
      email: validEmail,
      token: 'validtoken123',
      newPassword: 'ValidPassword123!',
      confirmPassword: 'DifferentPassword123!',
    },
  });
  await adminResetPassword(req4, res4);
  assert.strictEqual(res4.statusCode, 400);
  assert.match(res4.data.message, /passwords do not match/i);
});

test('8. Reset password fails with invalid token', async () => {
  resetMockStore();
  const validEmail = 'admin.tokens@whitecoat.academy';
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  await seedMockAdmin({
    email: validEmail,
    resetPasswordToken: hashedToken,
    resetPasswordExpire: new Date(Date.now() + 15 * 60 * 1000),
  });

  const { req, res } = createMockReqRes({
    body: {
      email: validEmail,
      token: 'completely_wrong_or_tampered_token_hex_string',
      newPassword: 'BrandNewSecurePassword@2026',
      confirmPassword: 'BrandNewSecurePassword@2026',
    },
  });

  await adminResetPassword(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.data.success, false);
  assert.match(res.data.message, /Invalid or expired password reset token/i);
});

test('9. Reset password fails when token has expired and cleans up expired token', async () => {
  resetMockStore();
  const validEmail = 'admin.expired@whitecoat.academy';
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Expired 5 minutes ago
  await seedMockAdmin({
    email: validEmail,
    resetPasswordToken: hashedToken,
    resetPasswordExpire: new Date(Date.now() - 5 * 60 * 1000),
  });

  const { req, res } = createMockReqRes({
    body: {
      email: validEmail,
      token: rawToken,
      newPassword: 'BrandNewSecurePassword@2026',
      confirmPassword: 'BrandNewSecurePassword@2026',
    },
  });

  await adminResetPassword(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.data.success, false);
  assert.match(res.data.message, /token has expired/i);

  // Expired token must be cleared from the record
  const adminInDb = testAdmins.get(validEmail);
  assert.strictEqual(adminInDb.resetPasswordToken, undefined);
  assert.strictEqual(adminInDb.resetPasswordExpire, undefined);
});

test('10. Valid reset token successfully updates password and invalidates token (single-use)', async () => {
  resetMockStore();
  const validEmail = 'admin.success@whitecoat.academy';
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const oldPassword = 'OldAdminPassword@2026';
  const newPassword = 'NewlyUpdatedPassword@2026!';

  await seedMockAdmin({
    email: validEmail,
    password: oldPassword,
    resetPasswordToken: hashedToken,
    resetPasswordExpire: new Date(Date.now() + 15 * 60 * 1000),
    tokenVersion: 2,
  });

  const { req, res } = createMockReqRes({
    body: {
      email: validEmail,
      token: rawToken,
      newPassword: newPassword,
      confirmPassword: newPassword,
    },
  });

  await adminResetPassword(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  assert.match(res.data.message, /Password has been reset successfully/i);

  // Verify DB state
  const updatedAdmin = testAdmins.get(validEmail);
  assert.strictEqual(updatedAdmin.resetPasswordToken, undefined, 'Reset token must be wiped');
  assert.strictEqual(updatedAdmin.resetPasswordExpire, undefined, 'Reset expiration must be wiped');
  assert.strictEqual(updatedAdmin.tokenVersion, 3, 'tokenVersion must be incremented to revoke existing JWTs');

  // Verify new password is a valid bcrypt hash
  assert.notStrictEqual(updatedAdmin.password, newPassword, 'Password must never be stored in plain text');
  const isMatch = await bcrypt.compare(newPassword, updatedAdmin.password);
  assert.strictEqual(isMatch, true, 'Stored password must match the new password via bcrypt');

  // Verify old password no longer matches
  const isOldMatch = await bcrypt.compare(oldPassword, updatedAdmin.password);
  assert.strictEqual(isOldMatch, false, 'Old password must no longer match');

  // 11. Reusing the same token must now fail (Single-use verification)
  const { req: reuseReq, res: reuseRes } = createMockReqRes({
    body: {
      email: validEmail,
      token: rawToken,
      newPassword: 'AnotherPassword@2026!',
      confirmPassword: 'AnotherPassword@2026!',
    },
  });

  await adminResetPassword(reuseReq, reuseRes);
  assert.strictEqual(reuseRes.statusCode, 400);
  assert.strictEqual(reuseRes.data.success, false);
  assert.match(reuseRes.data.message, /Invalid or expired password reset token/i);
});

test('12. Admin can log in successfully with the new password after reset', async () => {
  resetMockStore();
  const validEmail = 'admin.login.test@whitecoat.academy';
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const oldPassword = 'OldAdminPassword123!';
  const newPassword = 'NewAdminPassword456!';

  await seedMockAdmin({
    email: validEmail,
    name: 'Dr. John Watson',
    password: oldPassword,
    resetPasswordToken: hashedToken,
    resetPasswordExpire: new Date(Date.now() + 15 * 60 * 1000),
  });

  // Perform reset
  const { req: resetReq, res: resetRes } = createMockReqRes({
    body: {
      email: validEmail,
      token: rawToken,
      newPassword: newPassword,
      confirmPassword: newPassword,
    },
  });

  await adminResetPassword(resetReq, resetRes);
  assert.strictEqual(resetRes.statusCode, 200);

  // Attempt login with OLD password -> must fail with 401
  const { req: oldLoginReq, res: oldLoginRes } = createMockReqRes({
    body: {
      email: validEmail,
      password: oldPassword,
    },
  });

  await adminLogin(oldLoginReq, oldLoginRes);
  assert.strictEqual(oldLoginRes.statusCode, 401);
  assert.strictEqual(oldLoginRes.data.success, false);

  // Attempt login with NEW password -> must succeed with 200 and return JWT tokens
  const { req: newLoginReq, res: newLoginRes } = createMockReqRes({
    body: {
      email: validEmail,
      password: newPassword,
    },
  });

  await adminLogin(newLoginReq, newLoginRes);
  assert.strictEqual(newLoginRes.statusCode, 200);
  assert.strictEqual(newLoginRes.data.success, true);
  assert.ok(newLoginRes.data.token || newLoginRes.data.data?.token, 'Must return JWT token');
  assert.ok(newLoginRes.data.refreshToken || newLoginRes.data.data?.refreshToken, 'Must return refreshToken');
  assert.strictEqual(newLoginRes.data.user?.email, validEmail);
});
