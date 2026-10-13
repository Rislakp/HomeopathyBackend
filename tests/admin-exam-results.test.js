const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { app } = require('../server');
const memoryCache = require('../utils/cache');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

function simulateRequest(options) {
  return new Promise((resolve) => {
    const { method = 'GET', url = '/', headers = {}, body = null } = options;

    const req = {
      method,
      url,
      originalUrl: url,
      headers: {
        accept: 'application/json',
        ...headers,
      },
      body: body || {},
      query: {},
      params: {},
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      get(header) {
        return this.headers[header.toLowerCase()];
      },
    };

    if (url.includes('?')) {
      const [pathPart, queryPart] = url.split('?');
      req.path = pathPart;
      const searchParams = new URLSearchParams(queryPart);
      for (const [k, v] of searchParams.entries()) {
        req.query[k] = v;
      }
    } else {
      req.path = url;
    }

    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        this.headersSent = true;
        resolve({ statusCode: this.statusCode, headers: this.headers, body: this.body });
        return this;
      },
      send(data) {
        this.body = data;
        this.headersSent = true;
        resolve({ statusCode: this.statusCode, headers: this.headers, body: this.body });
        return this;
      },
      setHeader(key, value) {
        this.headers[key] = value;
        return this;
      },
      getHeader(key) {
        return this.headers[key];
      },
      setTimeout() {},
    };

    app.handle(req, res, () => {
      resolve({ statusCode: res.statusCode || 404, headers: res.headers, body: res.body });
    });
  });
}

function createTokens() {
  const adminId = new mongoose.Types.ObjectId().toString();
  const studentId = new mongoose.Types.ObjectId().toString();

  const adminToken = jwt.sign(
    { userId: adminId, id: adminId, adminId: adminId, role: 'admin', email: 'admin@whitecoat.academy' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const studentToken = jwt.sign(
    { userId: studentId, id: studentId, studentId: studentId, role: 'student', email: 'student@whitecoat.academy' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Prime cache for both RBAC and AdminAuthMiddleware
  memoryCache.set(`user_auth_${adminId}`, {
    _id: new mongoose.Types.ObjectId(adminId),
    id: adminId,
    userId: adminId,
    role: 'admin',
    email: 'admin@whitecoat.academy',
    name: 'Admin User',
  });
  memoryCache.set(`admin_auth_${adminId}`, {
    _id: new mongoose.Types.ObjectId(adminId),
    id: adminId,
    role: 'ADMIN',
    email: 'admin@whitecoat.academy',
    name: 'Admin User',
    isActive: true,
  });

  memoryCache.set(`user_auth_${studentId}`, {
    _id: new mongoose.Types.ObjectId(studentId),
    id: studentId,
    userId: studentId,
    role: 'student',
    email: 'student@whitecoat.academy',
    name: 'Student User',
  });

  return { adminId, studentId, adminToken, studentToken };
}

test('1. Admin Exam Results — Authentication & Authorization Enforcement', async () => {
  const { adminToken, studentToken } = createTokens();
  const validExamId = new mongoose.Types.ObjectId().toString();

  // 1a. Missing token -> 401
  const resNoAuth = await simulateRequest({
    method: 'GET',
    url: `/api/v1/admin/exams/${validExamId}/results`,
  });
  assert.strictEqual(resNoAuth.statusCode, 401, 'Request without token must be rejected with HTTP 401');
  assert.strictEqual(resNoAuth.body?.success, false);

  // 1b. Invalid token -> 401
  const resInvalidAuth = await simulateRequest({
    method: 'GET',
    url: `/api/v1/admin/exams/${validExamId}/results`,
    headers: { authorization: 'Bearer invalid.token.value' },
  });
  assert.strictEqual(resInvalidAuth.statusCode, 401, 'Request with invalid token must return HTTP 401');
  assert.strictEqual(resInvalidAuth.body?.success, false);

  // 1c. Student token -> 403 Forbidden
  const resStudent = await simulateRequest({
    method: 'GET',
    url: `/api/v1/admin/exams/${validExamId}/results`,
    headers: { authorization: `Bearer ${studentToken}` },
  });
  assert.strictEqual(resStudent.statusCode, 403, 'Student token must be rejected with HTTP 403 Forbidden');
  assert.strictEqual(resStudent.body?.success, false);
});

test('2. Admin Exam Results — Validation of Exam IDs (400 for invalid, 404 for nonexistent)', async () => {
  const { adminToken } = createTokens();

  // 2a. Malformed exam ID -> 400
  const resBadId = await simulateRequest({
    method: 'GET',
    url: '/api/v1/admin/exams/not-a-valid-object-id/results',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(resBadId.statusCode, 400, 'Malformed exam ID must return HTTP 400');
  assert.strictEqual(resBadId.body?.success, false);
  assert.match(resBadId.body?.message, /invalid exam id format/i);

  // 2b. Non-existent valid ObjectId -> 404
  const Exam = require('../models/Exam');
  const originalFindById = Exam.findById;
  Exam.findById = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });

  try {
    const nonexistentId = new mongoose.Types.ObjectId().toString();
    const resNotFound = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${nonexistentId}/results`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resNotFound.statusCode, 404, 'Nonexistent exam must return HTTP 404');
    assert.strictEqual(resNotFound.body?.success, false);
    assert.match(resNotFound.body?.message, /exam not found/i);
  } finally {
    Exam.findById = originalFindById;
  }
});

test('3. Admin Exam Results — Empty results returns 200 with valid pagination metadata', async () => {
  const { adminToken } = createTokens();
  const examId = new mongoose.Types.ObjectId();

  const Exam = require('../models/Exam');
  const TestResult = require('../src/common/models/testResult.model');
  const origExamFindById = Exam.findById;
  const origTRCount = TestResult.countDocuments;
  const origTRFind = TestResult.find;

  Exam.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: examId,
        title: 'Grand Mock Test 1',
        testType: 'grand_mock',
        marksPerQuestion: 4,
        totalQuestions: 100,
        durationMinutes: 120,
      }),
    }),
  });

  TestResult.countDocuments = async () => 0;
  TestResult.find = () => ({
    select: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [],
          }),
        }),
      }),
    }),
  });

  try {
    const res = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${examId.toString()}/results?page=1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(res.statusCode, 200, 'Empty exam results must return HTTP 200');
    assert.strictEqual(res.body?.success, true);
    assert.deepStrictEqual(res.body?.data, []);
    assert.strictEqual(res.body?.pagination?.page, 1);
    assert.strictEqual(res.body?.pagination?.limit, 20);
    assert.strictEqual(res.body?.pagination?.total, 0);
    assert.strictEqual(res.body?.pagination?.totalPages, 0);
  } finally {
    Exam.findById = origExamFindById;
    TestResult.countDocuments = origTRCount;
    TestResult.find = origTRFind;
  }
});

test('4. Admin Exam Results — Successful Retrieval, Data Formatting, and AcademicExamResultModel contract', async () => {
  const { adminToken } = createTokens();
  const examId = new mongoose.Types.ObjectId();
  const student1Id = new mongoose.Types.ObjectId();
  const student2Id = new mongoose.Types.ObjectId();
  const result1Id = new mongoose.Types.ObjectId();
  const result2Id = new mongoose.Types.ObjectId();

  const Exam = require('../models/Exam');
  const TestResult = require('../src/common/models/testResult.model');
  const Student = require('../models/Student');
  const User = require('../models/User');

  const origExamFindById = Exam.findById;
  const origTRCount = TestResult.countDocuments;
  const origTRFind = TestResult.find;
  const origStudentFind = Student.find;
  const origUserFind = User.find;

  Exam.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: examId,
        title: 'Homeopathy Grand Mock 2026',
        testType: 'grand_mock',
        marksPerQuestion: 4,
        totalQuestions: 50,
        durationMinutes: 60,
      }),
    }),
  });

  const mockResults = [
    {
      _id: result1Id,
      studentId: student1Id,
      examId: examId,
      score: 180,
      totalMarks: 200,
      totalAttempted: 48,
      totalCorrect: 45,
      totalWrong: 3,
      unansweredQuestions: 2,
      positiveMarks: 180,
      negativeMarks: 0,
      maximumScore: 200,
      percentage: 90,
      status: 'Completed',
      createdAt: new Date('2026-10-10T12:00:00.000Z'),
    },
    {
      _id: result2Id,
      studentId: student2Id,
      examId: examId,
      score: 160,
      totalMarks: 200,
      totalAttempted: 46,
      totalCorrect: 40,
      totalWrong: 6,
      unansweredQuestions: 4,
      positiveMarks: 160,
      negativeMarks: 0,
      maximumScore: 200,
      percentage: 80,
      status: 'Completed',
      createdAt: new Date('2026-10-10T13:00:00.000Z'),
    },
  ];

  TestResult.countDocuments = async () => 2;
  TestResult.find = () => ({
    select: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => mockResults,
          }),
        }),
      }),
    }),
  });

  Student.find = () => ({
    select: () => ({
      lean: async () => [
        {
          _id: student1Id,
          userId: null,
          name: 'Alice Johnson',
          email: 'alice@example.com',
          phone: '9876543210',
        },
      ],
    }),
  });

  User.find = () => ({
    select: () => ({
      lean: async () => [
        {
          _id: student2Id,
          name: 'Bob Smith',
          email: 'bob@example.com',
          phone: '9123456780',
        },
      ],
    }),
  });

  try {
    // 4a. Primary route: GET /api/v1/admin/exams/:examId/results
    const resV1 = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${examId.toString()}/results?page=1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(resV1.statusCode, 200);
    assert.strictEqual(resV1.body?.success, true);
    assert.strictEqual(resV1.body?.data?.length, 2);
    assert.strictEqual(resV1.body?.pagination?.total, 2);
    assert.strictEqual(resV1.body?.pagination?.totalPages, 1);

    const row1 = resV1.body.data[0];
    assert.strictEqual(row1._id, result1Id.toString());
    assert.strictEqual(row1.examId, examId.toString());
    assert.strictEqual(row1.studentName, 'Alice Johnson');
    assert.strictEqual(row1.studentEmail, 'alice@example.com');
    assert.strictEqual(row1.score, 180);
    assert.strictEqual(row1.totalMarks, 200);
    assert.strictEqual(row1.percentage, 90);
    assert.strictEqual(row1.totalAttempted, 48);
    assert.strictEqual(row1.correct, 45);
    assert.strictEqual(row1.wrong, 3);
    assert.strictEqual(row1.unanswered, 2);
    assert.strictEqual(row1.attemptStatus, 'Completed');
    assert.strictEqual(row1.submittedAt, '2026-10-10T12:00:00.000Z');
    // Ensure answers array is omitted for security & lightweight payloads
    assert.strictEqual(row1.answers, undefined, 'Sensitive answers array must not be exposed in results list');

    const row2 = resV1.body.data[1];
    assert.strictEqual(row2._id, result2Id.toString());
    assert.strictEqual(row2.studentName, 'Bob Smith');
    assert.strictEqual(row2.studentEmail, 'bob@example.com');
    assert.strictEqual(row2.score, 160);

    // 4b. Alias route: GET /api/admin/exams/:examId/results
    const resAlias = await simulateRequest({
      method: 'GET',
      url: `/api/admin/exams/${examId.toString()}/results?page=1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resAlias.statusCode, 200, 'Alias route /api/admin/exams/:id/results must return 200');
    assert.strictEqual(resAlias.body?.data?.length, 2);

    // 4c. Alias route: GET /api/v1/exams/:examId/results
    const resExamAlias = await simulateRequest({
      method: 'GET',
      url: `/api/v1/exams/${examId.toString()}/results?page=1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resExamAlias.statusCode, 200, 'Alias route /api/v1/exams/:id/results must return 200');
    assert.strictEqual(resExamAlias.body?.data?.length, 2);
  } finally {
    Exam.findById = origExamFindById;
    TestResult.countDocuments = origTRCount;
    TestResult.find = origTRFind;
    Student.find = origStudentFind;
    User.find = origUserFind;
  }
});

test('5. Admin Exam Results — Pagination parameters enforcement (page, limit, maxLimit)', async () => {
  const { adminToken } = createTokens();
  const examId = new mongoose.Types.ObjectId();

  const Exam = require('../models/Exam');
  const origExamFindById = Exam.findById;

  Exam.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: examId,
        title: 'Exam Pagination Test',
        testType: 'grand_mock',
      }),
    }),
  });

  try {
    // 5a. limit > 100 must be rejected with 400
    const resOverLimit = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${examId.toString()}/results?page=1&limit=250`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resOverLimit.statusCode, 400, 'Limit > 100 must be rejected with HTTP 400');
    assert.match(resOverLimit.body?.message, /limit exceeds maximum allowed size/i);

    // 5b. Invalid page (negative or non-integer) -> 400
    const resBadPage = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${examId.toString()}/results?page=-1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resBadPage.statusCode, 400, 'Negative page must return HTTP 400');
    assert.match(resBadPage.body?.message, /invalid page parameter/i);
  } finally {
    Exam.findById = origExamFindById;
  }
});

test('6. Admin Exam Results — Search query filter handling', async () => {
  const { adminToken } = createTokens();
  const examId = new mongoose.Types.ObjectId();
  const studentMatchId = new mongoose.Types.ObjectId();

  const Exam = require('../models/Exam');
  const TestResult = require('../src/common/models/testResult.model');
  const Student = require('../models/Student');
  const User = require('../models/User');

  const origExamFindById = Exam.findById;
  const origTRCount = TestResult.countDocuments;
  const origTRFind = TestResult.find;
  const origStudentFind = Student.find;
  const origUserFind = User.find;

  Exam.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: examId,
        title: 'Search Test Exam',
        testType: 'grand_mock',
        marksPerQuestion: 4,
        totalQuestions: 25,
      }),
    }),
  });

  // Mock search returning match
  Student.find = (filter) => {
    if (filter?.$or) {
      return {
        select: () => ({
          lean: async () => [
            { _id: studentMatchId, userId: null, name: 'Charlie SearchMatch', email: 'charlie@test.com' },
          ],
        }),
      };
    }
    return {
      select: () => ({
        lean: async () => [
          { _id: studentMatchId, userId: null, name: 'Charlie SearchMatch', email: 'charlie@test.com' },
        ],
      }),
    };
  };

  User.find = () => ({
    select: () => ({
      lean: async () => [],
    }),
  });

  TestResult.countDocuments = async () => 1;
  TestResult.find = () => ({
    select: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [
              {
                _id: new mongoose.Types.ObjectId(),
                studentId: studentMatchId,
                examId: examId,
                score: 96,
                totalMarks: 100,
                totalAttempted: 24,
                totalCorrect: 24,
                totalWrong: 0,
                unansweredQuestions: 1,
                percentage: 96,
                status: 'Completed',
                createdAt: new Date('2026-10-11T10:00:00.000Z'),
              },
            ],
          }),
        }),
      }),
    }),
  });

  try {
    const resSearch = await simulateRequest({
      method: 'GET',
      url: `/api/v1/admin/exams/${examId.toString()}/results?search=Charlie`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(resSearch.statusCode, 200);
    assert.strictEqual(resSearch.body?.data?.length, 1);
    assert.strictEqual(resSearch.body?.data[0]?.studentName, 'Charlie SearchMatch');
    assert.strictEqual(resSearch.body?.pagination?.total, 1);
  } finally {
    Exam.findById = origExamFindById;
    TestResult.countDocuments = origTRCount;
    TestResult.find = origTRFind;
    Student.find = origStudentFind;
    User.find = origUserFind;
  }
});
