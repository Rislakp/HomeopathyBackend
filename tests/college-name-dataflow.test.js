require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const memoryCache = require('../utils/cache');
const User = require('../models/User');
const Student = require('../models/Student');
const Admin = require('../models/admin.model');

const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

// Track test accounts to ensure 100% clean teardown
const createdEmails = new Set();

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

function generateAdminToken(adminDoc) {
  const adminId = adminDoc._id.toString();
  const token = jwt.sign(
    {
      adminId,
      userId: adminId,
      id: adminId,
      email: adminDoc.email,
      role: 'ADMIN',
    },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  memoryCache.set(`admin_auth_${adminId}`, {
    _id: adminDoc._id,
    id: adminId,
    email: adminDoc.email,
    role: 'ADMIN',
    isActive: true,
  });

  return token;
}

test.before(async () => {
  await connectDB();
});

test.after(async () => {
  if (createdEmails.size > 0) {
    const emails = Array.from(createdEmails);
    await User.deleteMany({ email: { $in: emails } });
    await Student.deleteMany({ email: { $in: emails } });
  }
  await mongoose.connection.close(false);
});

// Shared state between tests
let registeredStudentToken = null;
let registeredStudentId = null;
let adminStudentId = null;
let adminStudentEmail = null;

test('1. Student Registration — accepts, validates, persists in DB and returns collegeName', async () => {
  const email = `test.student.reg.${Date.now()}@example.com`;
  createdEmails.add(email);

  const regPayload = {
    name: 'Dr. Registration Student',
    email,
    password: 'SecurePassword123!',
    phone: `987${Math.floor(1000000 + Math.random() * 9000000)}`,
    qualification: 'BHMS',
    dateOfBirth: '1998-05-15',
    courses: ['Homeopathy'],
    collegeName: 'National Institute of Homeopathy, Kolkata',
  };

  const res = await simulateRequest({
    method: 'POST',
    url: '/api/auth/register',
    body: regPayload,
  });

  assert.strictEqual(res.statusCode, 201, `Registration must return 201: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body?.success, true);
  assert.strictEqual(res.body?.user?.collegeName, 'National Institute of Homeopathy, Kolkata');
  assert.strictEqual(res.body?.user?.college_name, 'National Institute of Homeopathy, Kolkata');

  registeredStudentToken = res.body?.token;
  registeredStudentId = res.body?.user?._id || res.body?.user?.id;

  // Verify real Database Persistence in both User and Student collections
  const savedUser = await User.findOne({ email }).lean();
  assert.ok(savedUser, 'User record must exist in MongoDB');
  assert.strictEqual(savedUser.collegeName, 'National Institute of Homeopathy, Kolkata');

  const savedStudent = await Student.findOne({ email }).lean();
  assert.ok(savedStudent, 'Student record must exist in MongoDB');
  assert.strictEqual(savedStudent.collegeName, 'National Institute of Homeopathy, Kolkata');
});

test('2. Student Registration with alias "college" — backwards compatibility', async () => {
  const email = `test.student.alias.${Date.now()}@example.com`;
  createdEmails.add(email);

  const regPayload = {
    name: 'Dr. Alias Student',
    email,
    password: 'SecurePassword123!',
    phone: `986${Math.floor(1000000 + Math.random() * 9000000)}`,
    qualification: 'BHMS',
    dateOfBirth: '1999-01-01',
    courses: ['Homeopathy'],
    college: 'Government Homeopathic Medical College, Calicut',
  };

  const res = await simulateRequest({
    method: 'POST',
    url: '/api/auth/register',
    body: regPayload,
  });

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body?.user?.collegeName, 'Government Homeopathic Medical College, Calicut');

  const savedUser = await User.findOne({ email }).lean();
  assert.strictEqual(savedUser.collegeName, 'Government Homeopathic Medical College, Calicut');

  const savedStudent = await Student.findOne({ email }).lean();
  assert.strictEqual(savedStudent.collegeName, 'Government Homeopathic Medical College, Calicut');
});

test('3. Admin Portal — Create Student with collegeName and return in response', async () => {
  const adminDoc = await Admin.findOne({ isActive: true });
  assert.ok(adminDoc, 'Active admin document must exist in DB');
  const adminToken = generateAdminToken(adminDoc);

  const email = `test.admin.student.${Date.now()}@example.com`;
  createdEmails.add(email);

  const payload = {
    name: 'Admin Created Student',
    email,
    password: 'TemporaryPassword123!',
    phoneNumber: `912${Math.floor(1000000 + Math.random() * 9000000)}`,
    collegeName: 'Father Muller Homoeopathic Medical College, Mangalore',
    qualification: 'MD (Hom)',
  };

  const res = await simulateRequest({
    method: 'POST',
    url: '/api/admin/students',
    headers: { authorization: `Bearer ${adminToken}` },
    body: payload,
  });

  assert.strictEqual(res.statusCode, 201, `Admin create student must return 201: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body?.success, true);
  assert.strictEqual(res.body?.data?.collegeName, 'Father Muller Homoeopathic Medical College, Mangalore');

  adminStudentId = (res.body?.data?._id || res.body?.data?.id || res.body?.data?.student_id)?.toString();
  adminStudentEmail = email;

  // Verify real Database persistence
  const savedStudent = await Student.findOne({ email }).lean();
  assert.ok(savedStudent, 'Student record must exist in MongoDB');
  assert.strictEqual(savedStudent.collegeName, 'Father Muller Homoeopathic Medical College, Mangalore');

  const savedUser = await User.findOne({ email }).lean();
  assert.ok(savedUser, 'Linked User record must exist in MongoDB');
  assert.strictEqual(savedUser.collegeName, 'Father Muller Homoeopathic Medical College, Mangalore');
});

test('4. Student Profile retrieval — returns collegeName across /auth/me, /students/profile, /student/profile', async () => {
  assert.ok(registeredStudentToken, 'Student token must be available from Test 1');

  // 4a. /api/auth/me
  const resAuthMe = await simulateRequest({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${registeredStudentToken}` },
  });
  assert.strictEqual(resAuthMe.statusCode, 200);
  assert.strictEqual(resAuthMe.body?.user?.collegeName, 'National Institute of Homeopathy, Kolkata');
  assert.strictEqual(resAuthMe.body?.user?.college_name, 'National Institute of Homeopathy, Kolkata');

  // 4b. /api/students/profile
  const resProfile = await simulateRequest({
    method: 'GET',
    url: '/api/students/profile',
    headers: { authorization: `Bearer ${registeredStudentToken}` },
  });
  assert.strictEqual(resProfile.statusCode, 200);
  assert.strictEqual(resProfile.body?.data?.collegeName, 'National Institute of Homeopathy, Kolkata');
  assert.strictEqual(resProfile.body?.data?.college_name, 'National Institute of Homeopathy, Kolkata');

  // 4c. /api/student/profile
  const resStudentProfile = await simulateRequest({
    method: 'GET',
    url: '/api/student/profile',
    headers: { authorization: `Bearer ${registeredStudentToken}` },
  });
  assert.strictEqual(resStudentProfile.statusCode, 200);
  assert.strictEqual(resStudentProfile.body?.data?.collegeName, 'National Institute of Homeopathy, Kolkata');
});

test('5. Admin Student Listing & Details — includes collegeName and handles legacy missing records', async () => {
  const adminDoc = await Admin.findOne({ isActive: true });
  const adminToken = generateAdminToken(adminDoc);

  // 5a. Admin Student List
  const resList = await simulateRequest({
    method: 'GET',
    url: '/api/admin/students',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(resList.statusCode, 200);
  assert.strictEqual(resList.body?.success, true);
  assert.ok(Array.isArray(resList.body?.data), 'Data must be an array of students');

  // Locate the created student via search
  const resSearch = await simulateRequest({
    method: 'GET',
    url: `/api/admin/students?search=${encodeURIComponent(adminStudentEmail)}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(resSearch.statusCode, 200);
  assert.strictEqual(resSearch.body?.success, true);
  const foundInList = (resSearch.body?.data || []).find(s => s.email === adminStudentEmail || s.id === adminStudentId);
  assert.ok(foundInList, 'Created student must be returned in search results');
  assert.strictEqual(foundInList.collegeName, 'Father Muller Homoeopathic Medical College, Mangalore');

  // Check any legacy student in list with missing college name returns safe string
  const studentWithNoCollege = resList.body.data.find(s => !s.collegeName);
  if (studentWithNoCollege) {
    assert.strictEqual(typeof studentWithNoCollege.collegeName, 'string', 'Missing college name defaults to string');
  }

  // 5b. Admin Student Details by ID
  const resDetail = await simulateRequest({
    method: 'GET',
    url: `/api/admin/students/${adminStudentId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(resDetail.statusCode, 200);
  assert.strictEqual(resDetail.body?.success, true);
  assert.strictEqual(resDetail.body?.data?.collegeName, 'Father Muller Homoeopathic Medical College, Mangalore');
  assert.strictEqual(resDetail.body?.data?.college_name, 'Father Muller Homoeopathic Medical College, Mangalore');
});

test('6. Student Update Details — Admin update & Student self update persist to database', async () => {
  const adminDoc = await Admin.findOne({ isActive: true });
  const adminToken = generateAdminToken(adminDoc);

  // 6a. Admin updates student collegeName
  const resAdminUpdate = await simulateRequest({
    method: 'PUT',
    url: `/api/admin/students/${adminStudentId}`,
    headers: { authorization: `Bearer ${adminToken}` },
    body: { collegeName: 'Updated College by Admin' },
  });
  assert.strictEqual(resAdminUpdate.statusCode, 200);

  // Verify in MongoDB
  const updatedStudentAdmin = await Student.findById(adminStudentId).lean();
  assert.strictEqual(updatedStudentAdmin.collegeName, 'Updated College by Admin');

  // 6b. Student self updates profile collegeName
  const resSelfUpdate = await simulateRequest({
    method: 'PUT',
    url: '/api/students/profile',
    headers: { authorization: `Bearer ${registeredStudentToken}` },
    body: { collegeName: 'Self-Updated College' },
  });
  assert.strictEqual(resSelfUpdate.statusCode, 200);

  // Verify in MongoDB
  const updatedUserSelf = await User.findById(registeredStudentId).lean();
  assert.strictEqual(updatedUserSelf.collegeName, 'Self-Updated College');

  const updatedStudentSelf = await Student.findOne({ user: registeredStudentId }).lean();
  if (updatedStudentSelf) {
    assert.strictEqual(updatedStudentSelf.collegeName, 'Self-Updated College');
  }
});

test('7. Unauthorized Requests — correctly rejected with 401/403', async () => {
  // Missing auth
  const resNoAuth = await simulateRequest({
    method: 'GET',
    url: '/api/admin/students',
  });
  assert.strictEqual(resNoAuth.statusCode, 401, 'Admin students list without token must return 401');

  // Student auth on admin endpoint
  const resStudentForbidden = await simulateRequest({
    method: 'GET',
    url: '/api/admin/students',
    headers: { authorization: `Bearer ${registeredStudentToken}` },
  });
  assert.ok([401, 403].includes(resStudentForbidden.statusCode), 'Student token on admin endpoint must return 401 or 403');
});

test('8. Admin Students Export — CSV contains College Name header and row data', async () => {
  const adminDoc = await Admin.findOne({ isActive: true });
  const adminToken = generateAdminToken(adminDoc);

  const resCsv = await simulateRequest({
    method: 'GET',
    url: '/api/admin/students/export?format=csv',
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.strictEqual(resCsv.statusCode, 200);
  assert.strictEqual(resCsv.headers['Content-Type'], 'text/csv');
  assert.ok(resCsv.body.includes('College Name'), 'CSV header must include College Name');
  assert.ok(resCsv.body.includes('Updated College by Admin'), 'CSV body must include the updated college name');
});
