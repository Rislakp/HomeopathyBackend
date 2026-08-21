const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const connectDB = require('../config/db');
const User = require('../models/User');
const { getJwtSecret } = require('../middleware/rbac');
const facultyRoutes = require('../routes/facultyRoutes');

async function testRouteAuth() {
  console.log('🔒 Testing Faculty Route RBAC Protection...');

  await connectDB();

  const app = express();
  app.use(express.json());
  app.use('/api/admin/faculty', facultyRoutes);

  const mockStudentId = new mongoose.Types.ObjectId();
  const mockAdminId = new mongoose.Types.ObjectId();

  // Create temporary test user with 'student' role
  await User.create({
    _id: mockStudentId,
    name: 'Test Student User',
    email: 'student.test.rbac@example.com',
    password: 'password123',
    role: 'student',
  });

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api/admin/faculty`;

    try {
      // 1. Unauthenticated GET request (no Bearer token) -> 401
      const res1 = await fetch(baseUrl);
      const data1 = await res1.json();
      console.log('Test 1 (No token) Status:', res1.status, 'Response:', data1);
      if (res1.status !== 401 || data1.success !== false) {
        throw new Error('Route Auth Test 1 Failed: Expected 401 without token');
      }

      // 2. Non-admin student token GET request -> 403
      const studentToken = jwt.sign(
        { userId: mockStudentId.toString(), role: 'student' },
        getJwtSecret()
      );
      const res2 = await fetch(baseUrl, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      const data2 = await res2.json();
      console.log('Test 2 (Student token) Status:', res2.status, 'Response:', data2);
      if (res2.status !== 403 || data2.success !== false) {
        throw new Error('Route Auth Test 2 Failed: Expected 403 for student role');
      }

      console.log('✅ Route RBAC Middleware protection verified successfully!');

      // Cleanup
      await User.findByIdAndDelete(mockStudentId);
      server.close();
      mongoose.connection.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ Route Auth Test Failed:', err);
      await User.findByIdAndDelete(mockStudentId);
      server.close();
      mongoose.connection.close();
      process.exit(1);
    }
  });
}

testRouteAuth();
