const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/db');
const Faculty = require('../models/Faculty');
const {
  createFaculty,
  getAllFaculty,
  getFacultyById,
  updateFaculty,
  deleteFaculty,
} = require('../controllers/facultyController');

// Mock Express req/res generator
function createMockReqRes(options = {}) {
  const req = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    user: options.user || null,
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

async function runTests() {
  console.log('🚀 Starting Faculty CRUD verification tests...');

  try {
    await connectDB();

    // Clean up any test faculty records before running tests
    const testEmail1 = 'dr.smith.test@example.com';
    const testEmail2 = 'dr.jones.test@example.com';
    await Faculty.deleteMany({ email: { $in: [testEmail1, testEmail2] } });

    console.log('\n--- Test 1: Create Faculty (POST /api/admin/faculty) ---');
    const { req: req1, res: res1 } = createMockReqRes({
      body: {
        fullName: 'Dr. John Smith',
        email: testEmail1,
        phoneNumber: '+1-555-0199',
        department: 'Classical Homeopathy',
        role: 'Department Head',
        status: 'Active',
        qualification: 'MD (Hom)',
      },
    });

    await createFaculty(req1, res1);
    console.log(`Status: ${res1.statusCode}`);
    console.log(`Response:`, res1.body);
    if (res1.statusCode !== 201 || !res1.body.success) {
      throw new Error('Test 1 failed: Could not create faculty');
    }
    const createdId = res1.body.data._id;

    console.log('\n--- Test 2: Create Duplicate Email Faculty (Validation) ---');
    const { req: req2, res: res2 } = createMockReqRes({
      body: {
        fullName: 'Dr. John Smith Duplicate',
        email: testEmail1,
        phoneNumber: '+1-555-0200',
        department: 'Organon of Medicine',
        role: 'Professor',
        status: 'Active',
        qualification: 'BHMS',
      },
    });

    await createFaculty(req2, res2);
    console.log(`Status: ${res2.statusCode}`);
    console.log(`Response:`, res2.body);
    if (res2.statusCode !== 400 || res2.body.success !== false) {
      throw new Error('Test 2 failed: Duplicate email check failed');
    }

    console.log('\n--- Test 3: Create Second Faculty Member ---');
    const { req: req3, res: res3 } = createMockReqRes({
      body: {
        fullName: 'Dr. Sarah Jones',
        email: testEmail2,
        phoneNumber: '+1-555-0888',
        department: 'Materia Medica',
        role: 'Senior Lecturer',
        status: 'On Leave',
        qualification: 'MD (Hom), PhD',
      },
    });

    await createFaculty(req3, res3);
    console.log(`Status: ${res3.statusCode}`);
    console.log(`Response:`, res3.body);
    if (res3.statusCode !== 201) {
      throw new Error('Test 3 failed: Could not create second faculty');
    }

    console.log('\n--- Test 4: Get All Faculty Members (GET /api/admin/faculty) ---');
    const { req: req4, res: res4 } = createMockReqRes({
      query: { page: '1', limit: '10' },
    });

    await getAllFaculty(req4, res4);
    console.log(`Status: ${res4.statusCode}`);
    console.log(`Count: ${res4.body.count}, Total: ${res4.body.total}`);
    if (res4.statusCode !== 200 || !res4.body.data || res4.body.data.length < 2) {
      throw new Error('Test 4 failed: Get all faculty failed');
    }

    console.log('\n--- Test 5: Search Faculty by Name/Email/Department ---');
    const { req: req5, res: res5 } = createMockReqRes({
      query: { search: 'Sarah' },
    });

    await getAllFaculty(req5, res5);
    console.log(`Status: ${res5.statusCode}, Count: ${res5.body.count}`);
    if (res5.statusCode !== 200 || res5.body.count !== 1 || res5.body.data[0].fullName !== 'Dr. Sarah Jones') {
      throw new Error('Test 5 failed: Search filter failed');
    }

    console.log('\n--- Test 6: Filter Faculty by Department and Status ---');
    const { req: req6, res: res6 } = createMockReqRes({
      query: { department: 'Classical Homeopathy', status: 'Active' },
    });

    await getAllFaculty(req6, res6);
    console.log(`Status: ${res6.statusCode}, Count: ${res6.body.count}`);
    if (res6.statusCode !== 200 || res6.body.count !== 1) {
      throw new Error('Test 6 failed: Department/Status filter failed');
    }

    console.log('\n--- Test 7: Get Single Faculty Member by ID (GET /api/admin/faculty/:id) ---');
    const { req: req7, res: res7 } = createMockReqRes({
      params: { id: createdId },
    });

    await getFacultyById(req7, res7);
    console.log(`Status: ${res7.statusCode}`);
    console.log(`FullName: ${res7.body.data.fullName}`);
    if (res7.statusCode !== 200 || res7.body.data._id.toString() !== createdId.toString()) {
      throw new Error('Test 7 failed: Get by ID failed');
    }

    console.log('\n--- Test 8: Update Faculty Member (PUT /api/admin/faculty/:id) ---');
    const { req: req8, res: res8 } = createMockReqRes({
      params: { id: createdId },
      body: {
        status: 'On Leave',
        role: 'Dean of Academics',
      },
    });

    await updateFaculty(req8, res8);
    console.log(`Status: ${res8.statusCode}`);
    console.log(`Updated Status: ${res8.body.data.status}, Role: ${res8.body.data.role}`);
    if (res8.statusCode !== 200 || res8.body.data.status !== 'On Leave' || res8.body.data.role !== 'Dean of Academics') {
      throw new Error('Test 8 failed: Update faculty failed');
    }

    console.log('\n--- Test 9: Delete Faculty Member (DELETE /api/admin/faculty/:id) ---');
    const { req: req9, res: res9 } = createMockReqRes({
      params: { id: createdId },
    });

    await deleteFaculty(req9, res9);
    console.log(`Status: ${res9.statusCode}`);
    console.log(`Message: ${res9.body.message}`);
    if (res9.statusCode !== 200 || !res9.body.success) {
      throw new Error('Test 9 failed: Delete faculty failed');
    }

    console.log('\n--- Test 10: Verify Deletion (Get Deleted ID) ---');
    const { req: req10, res: res10 } = createMockReqRes({
      params: { id: createdId },
    });

    await getFacultyById(req10, res10);
    console.log(`Status: ${res10.statusCode}`);
    if (res10.statusCode !== 404) {
      throw new Error('Test 10 failed: Deleted faculty still exists');
    }

    // Clean up second test faculty
    await Faculty.deleteMany({ email: { $in: [testEmail1, testEmail2] } });

    console.log('\n✅ All 10 Faculty CRUD tests passed successfully!');
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Verification Failed:', error);
    if (mongoose.connection.readyState !== 0) {
      mongoose.connection.close();
    }
    process.exit(1);
  }
}

runTests();
