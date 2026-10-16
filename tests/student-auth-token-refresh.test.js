const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Set predictable test environment secrets before importing auth modules
const TEST_JWT_SECRET = 'test_wca_jwt_super_secret_signing_key_2026_x!';
const TEST_REFRESH_SECRET = 'test_wca_refresh_super_secret_key_2026_y!';
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';

const {
  generateToken,
  generateRefreshToken,
  getJwtRefreshSecret,
  refreshTokenHandler,
  logoutHandler,
  universalLogin,
  studentLogin,
} = require('../controllers/authController');
const { requireAuth, getJwtSecret } = require('../middleware/rbac');
const User = require('../models/User');
const Student = require('../models/Student');
const Course = require('../models/Course');
const memoryCache = require('../utils/cache');

// Helper to construct mock Express request and response
const createMockReqRes = (options = {}) => {
  const req = {
    headers: { ...(options.headers || {}) },
    body: { ...(options.body || {}) },
    params: { ...(options.params || {}) },
    query: { ...(options.query || {}) },
    user: options.user || null,
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

// Mock student and user entities
const mockUserId = new mongoose.Types.ObjectId();
const mockStudentId = new mongoose.Types.ObjectId();
const mockCourseId1 = 'CRS-000001';
const mockCourseId2 = 'CRS-000056';

const createMockStudentUser = (overrides = {}) => ({
  _id: mockUserId,
  id: mockUserId.toString(),
  email: 'student.test@whitecoat.academy',
  name: 'Test Student',
  role: 'student',
  accountStatus: 'Approved',
  status: 'Active',
  tokenVersion: 0,
  courseId: mockCourseId1,
  courseIds: [mockCourseId1, mockCourseId2],
  courseRef: new mongoose.Types.ObjectId(),
  course: 'Homeopathy Mastery',
  preferredCourse: 'Homeopathy Mastery',
  matchPassword: async (pwd) => pwd === 'ValidPassword123!',
  save: async function () { return this; },
  ...overrides,
});

const createMockStudentDoc = (overrides = {}) => ({
  _id: mockStudentId,
  id: mockStudentId.toString(),
  userId: mockUserId,
  email: 'student.test@whitecoat.academy',
  name: 'Test Student',
  role: 'student',
  accountStatus: 'Approved',
  status: 'Active',
  isApproved: true,
  isActive: true,
  courseId: mockCourseId1,
  courseIds: [mockCourseId1, mockCourseId2],
  courseRef: new mongoose.Types.ObjectId(),
  course: 'Homeopathy Mastery',
  ...overrides,
});

// Setup mock DB lookups
let currentUserMock = createMockStudentUser();
let currentStudentDocMock = createMockStudentDoc();

// Intercept Mongoose lookups safely for pure unit/regression isolation
const originalUserFindById = User.findById;
const originalUserFindOne = User.findOne;
const originalStudentFindById = Student.findById;
const originalStudentFindOne = Student.findOne;
const originalCourseFindOne = Course.findOne;

function installDbMocks() {
  User.findById = (id) => ({
    select: () => ({
      lean: async () => (String(id) === String(currentUserMock._id) ? currentUserMock : null),
    }),
    then: (resolve) => resolve(String(id) === String(currentUserMock._id) ? currentUserMock : null),
  });

  User.findOne = (query) => ({
    select: () => ({
      lean: async () => {
        if (query.email && query.email.toLowerCase() === currentUserMock.email.toLowerCase()) {
          return currentUserMock;
        }
        return null;
      },
    }),
    then: (resolve) => {
      if (query.email && query.email.toLowerCase() === currentUserMock.email.toLowerCase()) {
        return resolve(currentUserMock);
      }
      return resolve(null);
    },
  });

  Student.findById = (id) => ({
    select: () => ({
      lean: async () => (String(id) === String(currentStudentDocMock._id) ? currentStudentDocMock : null),
    }),
    lean: async () => (String(id) === String(currentStudentDocMock._id) ? currentStudentDocMock : null),
    then: (resolve) => resolve(String(id) === String(currentStudentDocMock._id) ? currentStudentDocMock : null),
  });

  Student.findOne = (query) => ({
    select: () => ({
      lean: async () => currentStudentDocMock,
    }),
    lean: async () => currentStudentDocMock,
    then: (resolve) => resolve(currentStudentDocMock),
  });

  Course.findOne = () => ({
    lean: async () => ({
      _id: currentUserMock.courseRef,
      courseId: mockCourseId1,
      courseTitle: 'Homeopathy Mastery',
      title: 'Homeopathy Mastery',
    }),
    then: (resolve) => resolve({
      _id: currentUserMock.courseRef,
      courseId: mockCourseId1,
      courseTitle: 'Homeopathy Mastery',
      title: 'Homeopathy Mastery',
    }),
  });
}

function restoreDbMocks() {
  User.findById = originalUserFindById;
  User.findOne = originalUserFindOne;
  Student.findById = originalStudentFindById;
  Student.findOne = originalStudentFindOne;
  Course.findOne = originalCourseFindOne;
}

test.beforeEach(() => {
  memoryCache.flush();
  currentUserMock = createMockStudentUser();
  currentStudentDocMock = createMockStudentDoc();
  installDbMocks();
});

test.after(() => {
  restoreDbMocks();
});

// =============================================================================
// TEST SUITE: STUDENT AUTHENTICATION TOKEN LIFETIME & REFRESH REGRESSION
// =============================================================================

test('1. Valid token allows normal class and curriculum activity with full courseIds attached', async () => {
  const token = generateToken(currentUserMock, currentStudentDocMock);
  assert.ok(token, 'Access token must be generated');

  const { req, res } = createMockReqRes({
    headers: { authorization: `Bearer ${token}` },
  });

  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, 'requireAuth must call next() for valid active tokens');
  assert.ok(req.user, 'req.user must be populated');
  assert.equal(req.user.email, currentUserMock.email);
  assert.equal(req.user.role, 'student');
  assert.ok(Array.isArray(req.user.courseIds), 'req.user.courseIds must be an array');
  assert.ok(req.user.courseIds.includes(mockCourseId1), 'Primary enrolled course must be in req.user.courseIds');
  assert.ok(req.user.courseIds.includes(mockCourseId2), 'Multi-course enrollment must be preserved in req.user.courseIds');
});

test('2. Expired access token is rejected with 401 and TOKEN_EXPIRED error code', async () => {
  // Sign a token that expired 10 minutes ago
  const expiredToken = jwt.sign(
    {
      id: currentUserMock._id.toString(),
      userId: currentUserMock._id.toString(),
      role: 'student',
    },
    TEST_JWT_SECRET,
    { expiresIn: '-10m' }
  );

  const { req, res } = createMockReqRes({
    headers: { authorization: `Bearer ${expiredToken}` },
  });

  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'requireAuth must NOT call next() for expired tokens');
  assert.equal(res.statusCode, 401, 'Status code must be 401 Unauthorized');
  assert.equal(res.data.success, false);
  assert.equal(res.data.code, 'TOKEN_EXPIRED', 'Must return machine-readable TOKEN_EXPIRED error code for frontend interceptors');
  assert.match(res.data.message, /expired/i);
});

test('3. Refreshing an expired access token succeeds using valid refresh token', async () => {
  // Generate active refresh token
  const refreshToken = generateRefreshToken(currentUserMock);
  assert.ok(refreshToken, 'Refresh token must be generated');

  const { req, res } = createMockReqRes({
    body: { refreshToken },
  });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 200, 'Refresh endpoint must return 200 OK');
  assert.equal(res.data.success, true);
  assert.ok(res.data.token, 'Must return new access token in "token"');
  assert.ok(res.data.accessToken, 'Must return new access token in "accessToken"');
  assert.ok(res.data.refreshToken, 'Must return rotated refresh token');
  assert.equal(res.data.role, 'student');

  // Verify the newly generated access token is immediately valid for class access
  const newAccessToken = res.data.token;
  const decoded = jwt.verify(newAccessToken, TEST_JWT_SECRET);
  assert.equal(decoded.userId, currentUserMock._id.toString());
  assert.ok(Array.isArray(decoded.courseIds), 'Decoded courseIds must be an array');
  assert.ok(decoded.courseIds.includes(mockCourseId1));
  assert.ok(decoded.courseIds.includes(mockCourseId2));

  // Verify newly issued token passes requireAuth middleware
  const mockReqRes2 = createMockReqRes({
    headers: { authorization: `Bearer ${newAccessToken}` },
  });
  let nextCalled = false;
  await requireAuth(mockReqRes2.req, mockReqRes2.res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'Refreshed access token must pass authentication during class');
});

test('4. Expired refresh token is rejected with 401 and REFRESH_TOKEN_EXPIRED', async () => {
  const expiredRefreshToken = jwt.sign(
    {
      userId: currentUserMock._id.toString(),
      type: 'refresh',
      tokenVersion: 0,
      role: 'student',
    },
    TEST_REFRESH_SECRET,
    { expiresIn: '-1h' }
  );

  const { req, res } = createMockReqRes({
    body: { refreshToken: expiredRefreshToken },
  });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.data.success, false);
  assert.equal(res.data.code, 'REFRESH_TOKEN_EXPIRED');
});

test('5. Invalid or tampered refresh token is rejected with 401 and REFRESH_TOKEN_INVALID', async () => {
  const { req, res } = createMockReqRes({
    body: { refreshToken: 'invalid.jwt.token.signature' },
  });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.data.success, false);
  assert.equal(res.data.code, 'REFRESH_TOKEN_INVALID');
});

test('6. Access token used as a refresh token is rejected due to invalid token type', async () => {
  const normalAccessToken = generateToken(currentUserMock);

  const { req, res } = createMockReqRes({
    body: { refreshToken: normalAccessToken },
  });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 401, 'Access token must NOT be accepted as a refresh token');
  assert.equal(res.data.success, false);
  assert.ok(['INVALID_TOKEN_TYPE', 'REFRESH_TOKEN_INVALID'].includes(res.data.code));
});

test('7. Missing refresh token returns 400 Bad Request', async () => {
  const { req, res } = createMockReqRes({ body: {} });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.data.success, false);
  assert.equal(res.data.code, 'REFRESH_TOKEN_REQUIRED');
});

test('8. Token refresh enforces student account approval (cannot bypass pending/rejected status)', async () => {
  // Scenario A: Student account is Rejected
  currentUserMock.accountStatus = 'Rejected';
  currentStudentDocMock.accountStatus = 'Rejected';
  const refreshToken1 = generateRefreshToken(currentUserMock);

  const mock1 = createMockReqRes({ body: { refreshToken: refreshToken1 } });
  await refreshTokenHandler(mock1.req, mock1.res);

  assert.equal(mock1.res.statusCode, 403, 'Rejected student must be denied token refresh');
  assert.equal(mock1.res.data.code, 'ACCOUNT_DEACTIVATED');

  // Scenario B: Student account is Pending admin approval
  currentUserMock.accountStatus = 'Pending';
  currentStudentDocMock.accountStatus = 'Pending';
  currentStudentDocMock.status = 'Pending';
  const refreshToken2 = generateRefreshToken(currentUserMock);

  const mock2 = createMockReqRes({ body: { refreshToken: refreshToken2 } });
  await refreshTokenHandler(mock2.req, mock2.res);

  assert.equal(mock2.res.statusCode, 403, 'Pending student must be denied token refresh');
  assert.equal(mock2.res.data.code, 'ACCOUNT_PENDING_APPROVAL');
});

test('9. Revoked session via tokenVersion mismatch rejects old refresh tokens', async () => {
  // Issue refresh token with tokenVersion 0
  currentUserMock.tokenVersion = 0;
  const oldRefreshToken = generateRefreshToken(currentUserMock);

  // User changes password or logs out -> increments tokenVersion
  currentUserMock.tokenVersion = 1;

  const { req, res } = createMockReqRes({
    body: { refreshToken: oldRefreshToken },
  });

  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 401, 'Revoked refresh token must be rejected');
  assert.equal(res.data.code, 'SESSION_REVOKED');
});

test('10. Multi-instance consistency: token generated on Instance A verified and refreshed on Instance B', async () => {
  // Instance A and Instance B share the same secret in production
  const instanceASecret = TEST_JWT_SECRET;
  const instanceBSecret = TEST_JWT_SECRET;
  const instanceARefreshSecret = TEST_REFRESH_SECRET;
  const instanceBRefreshSecret = TEST_REFRESH_SECRET;

  // Instance A issues tokens
  const instanceAToken = jwt.sign(
    {
      id: currentUserMock._id.toString(),
      userId: currentUserMock._id.toString(),
      studentId: currentStudentDocMock._id.toString(),
      email: currentUserMock.email,
      role: 'student',
      courseIds: [mockCourseId1, mockCourseId2],
    },
    instanceASecret,
    { expiresIn: '15m' }
  );

  const instanceARefreshToken = jwt.sign(
    {
      id: currentUserMock._id.toString(),
      userId: currentUserMock._id.toString(),
      tokenVersion: 0,
      role: 'student',
      type: 'refresh',
    },
    instanceARefreshSecret,
    { expiresIn: '30d' }
  );

  // Instance B receives and verifies access token
  const decodedOnB = jwt.verify(instanceAToken, instanceBSecret);
  assert.equal(decodedOnB.userId, currentUserMock._id.toString());
  assert.deepEqual(decodedOnB.courseIds, [mockCourseId1, mockCourseId2]);

  // Instance B receives refresh request with Instance A's refresh token
  const { req, res } = createMockReqRes({ body: { refreshToken: instanceARefreshToken } });
  await refreshTokenHandler(req, res);

  assert.equal(res.statusCode, 200, 'Instance B must successfully refresh token from Instance A');
  assert.ok(res.data.token, 'Instance B must issue fresh token');

  // Negative test: Instance with mismatched JWT_SECRET safely rejects
  const mismatchedSecret = 'completely_different_instance_secret_key!';
  assert.throws(() => {
    jwt.verify(instanceAToken, mismatchedSecret);
  }, /invalid signature/i);
});

test('11. S3 media access URL default TTL is at least 2 hours (7200 seconds) for long classes', () => {
  const { S3_MEDIA_URL_TTL_SECONDS } = require('../utils/s3MediaSigner');
  assert.ok(S3_MEDIA_URL_TTL_SECONDS >= 7200, `S3 Media URL TTL should be >= 7200s (actual: ${S3_MEDIA_URL_TTL_SECONDS}s)`);
});
