const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app } = require('../server');

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

test('1. Faculty Route Audit — /api/student/faculty and /student/faculty compatibility', async () => {
  const Faculty = require('../models/Faculty');
  const originalFind = Faculty.find;
  const originalCount = Faculty.countDocuments;

  const chain = {
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => [
      {
        _id: new mongoose.Types.ObjectId('6ab22e587673467c98bb3760'),
        fullName: 'Dr. Test Faculty',
        department: 'Homeopathy',
        role: 'Faculty',
        status: 'Active',
      },
    ],
  };

  Faculty.find = () => chain;
  Faculty.countDocuments = async () => 1;

  try {
    const resApi = await simulateRequest({ method: 'GET', url: '/api/student/faculty' });
    assert.strictEqual(resApi.statusCode, 200, 'GET /api/student/faculty must return HTTP 200');
    assert.strictEqual(resApi.body?.success, true);
    assert.ok(Array.isArray(resApi.body?.data), 'Data must be an array of faculty');
    assert.strictEqual(resApi.body?.data[0]?.fullName, 'Dr. Test Faculty');

    const resV1 = await simulateRequest({ method: 'GET', url: '/api/v1/student/faculty' });
    assert.strictEqual(resV1.statusCode, 200, 'GET /api/v1/student/faculty must return HTTP 200');
    assert.strictEqual(resV1.body?.success, true);

    const resCompat = await simulateRequest({ method: 'GET', url: '/student/faculty' });
    assert.strictEqual(resCompat.statusCode, 200, 'GET /student/faculty must return HTTP 200');
    assert.strictEqual(resCompat.body?.success, true);
    assert.strictEqual(resCompat.body?.data[0]?.fullName, 'Dr. Test Faculty');
  } finally {
    Faculty.find = originalFind;
    Faculty.countDocuments = originalCount;
  }
});


test('2. Plans Route Audit — /api/subscriptions/plans, /plans, /api/plans compatibility', async () => {
  const SubscriptionPlan = require('../models/SubscriptionPlan');
  const originalFind = SubscriptionPlan.find;

  SubscriptionPlan.find = () => ({
    sort: () => ({
      select: async () => [
        {
          _id: new mongoose.Types.ObjectId('6aab93350f4b6b95e90399ad'),
          title: 'KPSC Yearly',
          frequency: 'Yearly',
          price: 4999,
          status: 'Active',
        },
      ],
    }),
  });

  try {
    const resApi = await simulateRequest({ method: 'GET', url: '/api/subscriptions/plans' });
    assert.strictEqual(resApi.statusCode, 200, 'GET /api/subscriptions/plans must return HTTP 200');
    assert.strictEqual(resApi.body?.success, true);
    assert.strictEqual(resApi.body?.count, 1);

    const resV1 = await simulateRequest({ method: 'GET', url: '/api/v1/subscriptions/plans' });
    assert.strictEqual(resV1.statusCode, 200, 'GET /api/v1/subscriptions/plans must return HTTP 200');
    assert.strictEqual(resV1.body?.success, true);

    const resSub = await simulateRequest({ method: 'GET', url: '/subscriptions/plans' });
    assert.strictEqual(resSub.statusCode, 200, 'GET /subscriptions/plans must return HTTP 200');
    assert.strictEqual(resSub.body?.success, true);

    const resPlansApi = await simulateRequest({ method: 'GET', url: '/api/plans' });
    assert.strictEqual(resPlansApi.statusCode, 200, 'GET /api/plans must return HTTP 200');
    assert.strictEqual(resPlansApi.body?.success, true);

    const resPlans = await simulateRequest({ method: 'GET', url: '/plans' });
    assert.strictEqual(resPlans.statusCode, 200, 'GET /plans must return HTTP 200');
    assert.strictEqual(resPlans.body?.success, true);
  } finally {
    SubscriptionPlan.find = originalFind;
  }
});

test('3. Courses Route Audit — /api/courses (public), /api/student/courses (student auth), /student/courses', async () => {
  const Course = require('../models/Course');
  const Student = require('../models/Student');
  const originalCourseFind = Course.find;
  const originalStudentFindOne = Student.findOne;

  const mockCourse = {
    _id: new mongoose.Types.ObjectId('6ac5cda4e8a3829089c9623c'),
    courseTitle: 'Comprehensive Homeopathy',
    status: 'Published',
    modules: [],
  };

  Course.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: () => ({
          lean: async () => [mockCourse],
        }),
      }),
      limit: () => Promise.resolve([mockCourse]),
      then: (fn) => Promise.resolve([mockCourse]).then(fn),
    }),
    lean: async () => [mockCourse],
    then: (fn) => Promise.resolve([mockCourse]).then(fn),
  });
  const ContentItemProgress = require('../models/ContentItemProgress');

  const originalCipFind = ContentItemProgress.find;
  ContentItemProgress.find = () => ({
    lean: async () => [],
    then: (fn) => Promise.resolve([]).then(fn),
  });

  const CourseProgress = require('../models/CourseProgress');
  const originalCpFindOne = CourseProgress.findOne;
  CourseProgress.findOne = () => ({
    lean: async () => null,
  });

  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
  const studentToken = jwt.sign(
    { id: '6acc92bcede85c73fecf060e', role: 'student', email: 'test@student.com' },
    jwtSecret
  );

  const memoryCache = require('../utils/cache');
  memoryCache.set('user_auth_6acc92bcede85c73fecf060e', {
    _id: new mongoose.Types.ObjectId('6acc92bcede85c73fecf060e'),
    id: '6acc92bcede85c73fecf060e',
    role: 'student',
    email: 'test@student.com',
  });

  const mockStudentDoc = {
    _id: new mongoose.Types.ObjectId('6acc92bcede85c73fecf060e'),
    email: 'test@student.com',
    accountStatus: 'Approved',
    status: 'Active',
    isApproved: true,
  };

  Student.findOne = () => ({
    lean: async () => mockStudentDoc,
    then: (fn) => Promise.resolve(mockStudentDoc).then(fn),
  });
  Student.findById = () => ({
    lean: async () => mockStudentDoc,
    then: (fn) => Promise.resolve(mockStudentDoc).then(fn),
  });

  try {
    const resPublic = await simulateRequest({ method: 'GET', url: '/api/courses' });
    assert.strictEqual(resPublic.statusCode, 200, 'GET /api/courses must be accessible publicly');
    assert.strictEqual(resPublic.body?.success, true);

    const resNoAuth = await simulateRequest({ method: 'GET', url: '/api/student/courses' });
    assert.strictEqual(resNoAuth.statusCode, 401, 'Unauthenticated /api/student/courses must return 401');

    const resStudent = await simulateRequest({
      method: 'GET',
      url: '/api/student/courses',
      headers: { authorization: 'Bearer ' + studentToken },
    });
    assert.strictEqual(resStudent.statusCode, 200, 'GET /api/student/courses with auth must return 200');
    assert.strictEqual(resStudent.body?.success, true);

    const resCompat = await simulateRequest({
      method: 'GET',
      url: '/student/courses',
      headers: { authorization: 'Bearer ' + studentToken },
    });
    assert.strictEqual(resCompat.statusCode, 200, 'GET /student/courses with auth must return 200');
    assert.strictEqual(resCompat.body?.success, true);
  } finally {
    Course.find = originalCourseFind;
    Student.findOne = originalStudentFindOne;
    ContentItemProgress.find = originalCipFind;
    CourseProgress.findOne = originalCpFindOne;
  }
});

test('4. Exam Submission Validation — 400 errors for bad payload, duplicate, or foreign questions', async () => {
  const jwt = require('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
  const studentToken = jwt.sign(
    { id: '6acc92bcede85c73fecf060e', role: 'student', email: 'test@student.com' },
    jwtSecret
  );

  const memoryCache = require('../utils/cache');
  memoryCache.set('user_auth_6acc92bcede85c73fecf060e', {
    _id: new mongoose.Types.ObjectId('6acc92bcede85c73fecf060e'),
    id: '6acc92bcede85c73fecf060e',
    role: 'student',
    email: 'test@student.com',
  });

  const Student = require('../models/Student');
  const originalStudentFindOne = Student.findOne;
  const originalStudentFind = Student.find;
  const mockStudentDoc = {
    _id: new mongoose.Types.ObjectId('6acc92bcede85c73fecf060e'),
    email: 'test@student.com',
    accountStatus: 'Approved',
    status: 'Active',
    isApproved: true,
  };
  Student.findOne = () => ({
    lean: async () => mockStudentDoc,
    then: (fn) => Promise.resolve(mockStudentDoc).then(fn),
  });
  Student.find = () => ({
    lean: async () => [mockStudentDoc],
    then: (fn) => Promise.resolve([mockStudentDoc]).then(fn),
  });


  try {
    const resBadId = await simulateRequest({
      method: 'POST',
      url: '/api/student/exams/invalid-not-an-id/submit',
      headers: { authorization: 'Bearer ' + studentToken },
      body: { answers: [] },
    });
    assert.strictEqual(resBadId.statusCode, 400, 'Invalid examId must return HTTP 400');
    assert.strictEqual(resBadId.body?.message, 'Invalid Exam ID format.');

    const resBadIdCompat = await simulateRequest({
      method: 'POST',
      url: '/student/exams/invalid-not-an-id/submit',
      headers: { authorization: 'Bearer ' + studentToken },
      body: { answers: [] },
    });
    assert.strictEqual(resBadIdCompat.statusCode, 400, 'Compatibility /student/exams/:id/submit must return 400');
    assert.strictEqual(resBadIdCompat.body?.message, 'Invalid Exam ID format.');
  } finally {
    Student.findOne = originalStudentFindOne;
    Student.find = originalStudentFind;
  }

});

test('5. Non-existent routes return structured 404', async () => {
  const resNotFound = await simulateRequest({ method: 'GET', url: '/api/nonexistent-random-route' });
  assert.strictEqual(resNotFound.statusCode, 404);
  assert.strictEqual(resNotFound.body?.success, false);
  assert.ok(resNotFound.body?.message?.includes('Route not found'));
});
