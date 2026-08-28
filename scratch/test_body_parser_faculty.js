const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Faculty = require('../models/Faculty');
const User = require('../models/User');
const Admin = require('../models/admin.model');
const { getJwtSecret } = require('../middleware/rbac');
const facultyRoutes = require('../routes/facultyRoutes');

// Mock Mongoose DB models for standalone verification
const mockAdminId = new mongoose.Types.ObjectId().toString();

User.findById = function() {
  return {
    select: async () => ({
      _id: mockAdminId,
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
    }),
  };
};

Admin.findById = function() {
  return {
    select: async () => null,
  };
};

Faculty.findOne = async function() {
  return null;
};

Faculty.prototype.save = async function() {
  return {
    _id: new mongoose.Types.ObjectId(),
    fullName: this.fullName,
    email: this.email,
    phoneNumber: this.phoneNumber,
    department: this.department,
    role: this.role,
    status: this.status,
    qualification: this.qualification,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

async function testBodyParserAndFacultyController() {
  console.log('🧪 Starting Body Parser & Faculty Controller verification test...');

  const app = express();

  // Register body parser middleware exactly as in server.js
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount faculty routes
  app.use('/api/admin/faculty', facultyRoutes);

  const adminToken = jwt.sign(
    { userId: mockAdminId, role: 'admin' },
    getJwtSecret()
  );

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/api/admin/faculty`;

    try {
      // Test 1: Standard JSON body payload
      console.log('Testing Test 1: Standard JSON Payload...');
      const res1 = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          fullName: 'Dr. Test One',
          email: 'test1.faculty@example.com',
          phoneNumber: '9876543210',
          department: 'Homeopathic Materia Medica',
          role: 'Professor',
          qualification: 'MD (Homeopathy)',
        }),
      });
      const data1 = await res1.json();
      console.log('Test 1 Response Status:', res1.status, 'Body:', data1);

      if (res1.status !== 201 || !data1.success) {
        throw new Error(`Test 1 Failed: ${JSON.stringify(data1)}`);
      }
      console.log('✅ Test 1 Passed!');

      // Test 2: URL-Encoded form data payload
      console.log('Testing Test 2: URL-Encoded Payload...');
      const params = new URLSearchParams();
      params.append('fullName', 'Dr. Test Two');
      params.append('email', 'test2.faculty@example.com');
      params.append('phoneNumber', '9876543211');
      params.append('department', 'Organon of Medicine');
      params.append('role', 'Associate Professor');
      params.append('qualification', 'BHMS');

      const res2 = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: params.toString(),
      });
      const data2 = await res2.json();
      console.log('Test 2 Response Status:', res2.status, 'Body:', data2);

      if (res2.status !== 201 || !data2.success) {
        throw new Error(`Test 2 Failed: ${JSON.stringify(data2)}`);
      }
      console.log('✅ Test 2 Passed!');

      // Test 3: JSON payload with alias field names (e.g. name, phone, dept, designation, degree)
      console.log('Testing Test 3: Field Alias Payload...');
      const res3 = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Dr. Test Three',
          email: 'test3.faculty@example.com',
          phone: '9876543212',
          dept: 'Repertory',
          designation: 'Assistant Professor',
          degree: 'MD',
        }),
      });
      const data3 = await res3.json();
      console.log('Test 3 Response Status:', res3.status, 'Body:', data3);

      if (res3.status !== 201 || !data3.success) {
        throw new Error(`Test 3 Failed: ${JSON.stringify(data3)}`);
      }
      console.log('✅ Test 3 Passed!');

      // Test 4: Missing field validation check
      console.log('Testing Test 4: Validation for missing fields...');
      const res4 = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          fullName: 'Dr. Incomplete',
          email: 'incomplete@example.com',
          // phoneNumber omitted
        }),
      });
      const data4 = await res4.json();
      console.log('Test 4 Response Status:', res4.status, 'Body:', data4);

      if (res4.status !== 400 || data4.success !== false) {
        throw new Error(`Test 4 Failed: Expected 400 error for missing fields`);
      }
      console.log('✅ Test 4 Passed!');

      console.log('🎉 All Body Parser & Faculty Controller Verification Tests Passed!');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ Test failed:', err);
      server.close();
      process.exit(1);
    }
  });
}

testBodyParserAndFacultyController();
