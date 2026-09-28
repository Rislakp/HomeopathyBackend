require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const { app } = require('../server');
const User = require('../models/User');
const { getJwtSecret } = require('../middleware/rbac');

let server;
const PORT = 5577;

function request(path, token) {
  const start = Date.now();
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - start;
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, duration, sizeBytes: Buffer.byteLength(data), body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runBenchmark() {
  console.log('=== ADMIN PORTAL BACKEND PERFORMANCE BENCHMARK ===\n');
  const t0 = Date.now();
  await connectDB();
  const dbTime = Date.now() - t0;
  console.log(`⏱ DB Connection time: ${dbTime}ms`);

  server = app.listen(0);
  const actualPort = server.address().port;
  console.log(`🚀 Benchmark server listening on port ${actualPort}\n`);

  try {
    const adminUser = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
    if (!adminUser) {
      console.error('No admin user found in database!');
      server.close();
      await mongoose.connection.close();
      process.exit(1);
    }

    const secret = getJwtSecret();
    const token = jwt.sign(
      {
        id: adminUser._id.toString(),
        userId: adminUser._id.toString(),
        adminId: adminUser._id.toString(),
        email: adminUser.email,
        role: adminUser.role,
      },
      secret,
      { expiresIn: '1d' }
    );

    const endpoints = [
      { name: 'Dashboard Stats', path: '/api/admin/dashboard-stats' },
      { name: 'Recent Activities', path: '/api/admin/activities' },
      { name: 'Students List (p=1, l=20)', path: '/api/students?page=1&limit=20' },
      { name: 'Courses List', path: '/api/courses' },
      { name: 'Grand Mocks List', path: '/api/exams/grand-mock' },
      { name: 'Unani Exams List', path: '/api/unani/exams' },
    ];

    console.log('----------------------------------------------------------------------------------');
    console.log(String('Endpoint').padEnd(30) + String('Status').padEnd(10) + String('Duration').padEnd(15) + String('Payload Size').padEnd(15));
    console.log('----------------------------------------------------------------------------------');

    let totalDuration = 0;
    for (const ep of endpoints) {
      const res = await request(ep.path, token);
      totalDuration += res.duration;
      console.log(
        String(ep.name).padEnd(30) +
        String(res.status).padEnd(10) +
        String(`${res.duration}ms`).padEnd(15) +
        String(`${(res.sizeBytes / 1024).toFixed(2)} KB`).padEnd(15)
      );
    }

    console.log('----------------------------------------------------------------------------------');
    console.log(`⚡ Cumulative Initial Data Load Time (All APIs combined): ${totalDuration}ms`);
    console.log('----------------------------------------------------------------------------------\n');

    console.log('🎉 BENCHMARK COMPLETED SUCCESSFULLY!');
    server.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Benchmark Error:', err);
    if (server) server.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

runBenchmark();
