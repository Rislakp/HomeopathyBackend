const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

async function run() {
  const { app, startServer } = require('../server');
  await startServer();

  const User = require('../models/User');
  const Admin = require('../models/admin.model');

  // Find or create admin
  let admin = await Admin.findOne();
  if (!admin) {
    admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  }

  // Find or create student
  let student = await User.findOne({ role: 'student' });
  if (!student) {
    student = await User.create({
      name: 'Perf Test Student',
      email: 'perf_student@test.com',
      password: 'password123',
      role: 'student',
      preferredCourse: 'UNANI',
      course: 'UNANI',
      courseId: 'CRS-000056',
    });
  }

  const jwtSecret = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';
  const adminToken = jwt.sign(
    {
      id: admin._id.toString(),
      adminId: admin._id.toString(),
      userId: admin._id.toString(),
      email: admin.email,
      role: admin.role || 'superadmin',
    },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const studentToken = jwt.sign(
    {
      id: student._id.toString(),
      userId: student._id.toString(),
      email: student.email,
      role: 'student',
      courseId: 'CRS-000056',
      courseRef: '6ab505e20047831b14861a8f',
    },
    jwtSecret,
    { expiresIn: '1h' }
  );

  const testEndpoints = [
    { name: 'GET /api/admin/students?page=1&limit=20', path: '/api/admin/students?page=1&limit=20', token: adminToken },
    { name: 'GET /api/faculty?page=1&limit=20', path: '/api/faculty?page=1&limit=20', token: adminToken },
    { name: 'GET /api/admin/faculty?page=1&limit=20', path: '/api/admin/faculty?page=1&limit=20', token: adminToken },
    { name: 'GET /api/courses?page=1&limit=20', path: '/api/courses?page=1&limit=20', token: studentToken },
    { name: 'GET /api/recordings?page=1&limit=20', path: '/api/recordings?page=1&limit=20', token: adminToken },
    { name: 'GET /api/live-records?page=1&limit=20', path: '/api/live-records?page=1&limit=20', token: adminToken },
    { name: 'GET /api/exams?page=1&limit=20', path: '/api/exams?page=1&limit=20', token: adminToken },
    { name: 'GET /api/unani-exams?page=1&limit=20', path: '/api/unani-exams?page=1&limit=20', token: studentToken },
    { name: 'GET /api/unani-exams/history?page=1&limit=10', path: '/api/unani-exams/history?page=1&limit=10', token: adminToken },
    { name: 'GET /api/admin/dashboard-stats', path: '/api/admin/dashboard-stats', token: adminToken },
    { name: 'GET /api/admin/activities', path: '/api/admin/activities', token: adminToken },
    { name: 'GET /health', path: '/health', token: null },
  ];

  console.log('\n========================================================================================');
  console.log('ENDPOINT PERFORMANCE & INTEGRITY SMOKE TEST RESULTS');
  console.log('========================================================================================\n');

  console.log('| Endpoint | Method | Status | Duration | Payload Size | Result |');
  console.log('| :--- | :---: | :---: | :---: | :---: | :---: |');

  for (const ep of testEndpoints) {
    const start = process.hrtime.bigint();
    const result = await new Promise((resolve) => {
      const options = {
        hostname: '127.0.0.1',
        port: 5000,
        path: ep.path,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(ep.token ? { 'Authorization': `Bearer ${ep.token}` } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const duration = Math.round(Number(end - start) / 1e6);
          const sizeBytes = Buffer.byteLength(body, 'utf8');
          const sizeStr = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(2)} KB` : `${sizeBytes} B`;
          resolve({
            status: res.statusCode,
            duration,
            sizeStr,
            success: res.statusCode >= 200 && res.statusCode < 300,
          });
        });
      });

      req.on('error', (err) => {
        const end = process.hrtime.bigint();
        const duration = Math.round(Number(end - start) / 1e6);
        resolve({
          status: 'ERR',
          duration,
          sizeStr: '0 B',
          success: false,
          error: err.message,
        });
      });

      req.end();
    });

    const statusBadge = result.success ? `✅ ${result.status}` : `❌ ${result.status}`;
    const speedBadge = result.duration < 500 ? `${result.duration}ms` : `⚠️ ${result.duration}ms`;
    console.log(`| \`${ep.path}\` | GET | ${statusBadge} | ${speedBadge} | ${result.sizeStr} | ${result.success ? 'PASS' : 'FAIL'} |`);
  }

  console.log('\n========================================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
