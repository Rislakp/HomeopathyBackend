const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { app } = require('../server');
const User = require('../models/User');
const Faculty = require('../models/Faculty');

const PORT = 5098;
const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
let server;

function req(urlPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const request = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function run() {
  console.log('--- STARTING FACULTY API TESTS ---');
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(PORT, () => console.log(`Test server running on port ${PORT}`));

  const admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  if (!admin) throw new Error('No admin found');
  const adminToken = jwt.sign({ id: admin._id, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  let passed = 0, failed = 0;
  const check = (label, condition, details = '') => {
    if (condition) {
      console.log(`✅ ${label}`);
      passed++;
    } else {
      console.error(`❌ ${label} ${details}`);
      failed++;
    }
  };

  try {
    // 1. Create Faculty A
    const resA = await req('/api/faculty', 'POST', adminHeaders, {
      fullName: 'Faculty A', email: 'facA@test.com', department: 'Anatomy', role: 'Professor', qualification: 'MD', avatarUrl: 'http://img.A'
    });
    check('Create Faculty A (201)', resA.status === 201);
    const idA = resA.body.data._id;

    // 2. Create Faculty B
    const resB = await req('/api/faculty', 'POST', adminHeaders, {
      fullName: 'Faculty B', email: 'facB@test.com', department: 'Physiology', role: 'Assistant Professor', qualification: 'MBBS', avatarUrl: 'http://img.B'
    });
    check('Create Faculty B (201)', resB.status === 201);
    const idB = resB.body.data._id;

    // 3. GET List
    const resList = await req('/api/faculty', 'GET', adminHeaders);
    check('GET List (200)', resList.status === 200);
    
    // 4. GET by ID
    const resGetA = await req(`/api/faculty/${idA}`, 'GET', adminHeaders);
    // Note: the controller doesn't have an admin GET single by ID endpoint! It only has getAllFacultyAdmin and student endpoints.
    // Let's check student get by ID
    const resGetAStudent = await req(`/api/student/faculty/${idA}`, 'GET');
    check('GET Student By ID (200)', resGetAStudent.status === 200);

    // 5. Partial Update A
    const resUpdateA = await req(`/api/faculty/${idA}`, 'PUT', adminHeaders, { role: 'HOD' });
    check('Update A (200)', resUpdateA.status === 200);
    
    // Check DB for A
    const dbA = await Faculty.findById(idA);
    check('Partial update preserved other fields (A)', dbA.avatarUrl === 'http://img.A' && dbA.role === 'HOD');

    // Check DB for B (Isolation check)
    const dbB = await Faculty.findById(idB);
    check('Isolation: B was NOT modified when updating A', dbB.role === 'Assistant Professor');

    // 6. Auth verification
    const resNoAuth = await req('/api/faculty', 'POST', {}, { fullName: 'Faculty C', email: 'facC@test.com', department: 'X', role: 'Y', qualification: 'Z' });
    check('Auth: No token -> 401', resNoAuth.status === 401);

    const studentUser = await User.findOne({ role: 'student' });
    if(studentUser) {
        const studentToken = jwt.sign({ id: studentUser._id, role: 'student' }, JWT_SECRET, { expiresIn: '1h' });
        const resStudentAuth = await req('/api/faculty', 'POST', { Authorization: `Bearer ${studentToken}` }, { fullName: 'Faculty C', email: 'facC@test.com', department: 'X', role: 'Y', qualification: 'Z' });
        check('Auth: Student token -> 403', resStudentAuth.status === 403);
    }

    // 7. Delete
    const resDel = await req(`/api/faculty/${idA}`, 'DELETE', adminHeaders);
    check('Delete A (200)', resDel.status === 200);
    const dbACheck = await Faculty.findById(idA);
    check('Delete removed from DB', dbACheck === null);

    // Cleanup
    await Faculty.findByIdAndDelete(idB);

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}
run();
