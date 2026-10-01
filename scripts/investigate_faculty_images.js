require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { app } = require('../server');
const Faculty = require('../models/Faculty');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const http = require('http');

async function runInvestigation() {
  await connectDB();
  console.log('=== FACULTY PROFILE IMAGE BACKEND INVESTIGATION ===\n');

  // STEP 4 & 8: Inspect exact MongoDB Faculty documents
  console.log('=== STEP 4 & 8: INSPECTING MONGODB FACULTY RECORDS ===');
  const allFaculty = await Faculty.find({}).lean();
  console.log(`Total Faculty records in MongoDB: ${allFaculty.length}\n`);

  const avatarMap = new Map();
  let duplicateAvatarCount = 0;

  allFaculty.forEach((f, index) => {
    console.log(`Faculty [${index + 1}]:`);
    console.log(`  _id:          ${f._id}`);
    console.log(`  fullName:     ${f.fullName || f.name || 'N/A'}`);
    console.log(`  email:        ${f.email}`);
    console.log(`  avatarUrl:    ${JSON.stringify(f.avatarUrl)}`);
    console.log(`  profileImage: ${JSON.stringify(f.profileImage)}`);
    console.log(`  avatar:       ${JSON.stringify(f.avatar)}`);
    console.log(`  image:        ${JSON.stringify(f.image)}`);
    console.log(`  imageUrl:     ${JSON.stringify(f.imageUrl)}`);
    console.log(`  photo:        ${JSON.stringify(f.photo)}`);
    console.log('--------------------------------------------------');

    const img = f.avatarUrl || f.profileImage || f.avatar || f.image || f.imageUrl || f.photo;
    if (img && img.trim() !== '') {
      if (avatarMap.has(img)) {
        duplicateAvatarCount++;
        console.log(`  ⚠️ DUPLICATE AVATAR DETECTED! Shared with: ${avatarMap.get(img)}`);
      } else {
        avatarMap.set(img, `${f.fullName} (${f._id})`);
      }
    }
  });

  console.log(`\nDuplicate avatarUrl check result: ${duplicateAvatarCount} duplicate(s) found across ${allFaculty.length} records.`);

  // STEP 9: Test real API with authenticated requests
  console.log('\n=== STEP 9: TESTING REAL API (PUT / GET / GET LIST) ===');

  const adminUser = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  if (!adminUser) {
    console.error('No admin user found!');
    process.exit(1);
  }

  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-min-32-chars-long-for-jwt-signing!!';
  const token = jwt.sign(
    { id: adminUser._id.toString(), email: adminUser.email, role: adminUser.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const server = app.listen(0);
  const port = server.address().port;

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const payloadStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'localhost',
        port: port,
        path: path,
        method: method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };
      if (payloadStr) {
        options.headers['Content-Length'] = Buffer.byteLength(payloadStr);
      }

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            json = data;
          }
          resolve({ status: res.statusCode, data: json });
        });
      });
      req.on('error', reject);
      if (payloadStr) req.write(payloadStr);
      req.end();
    });
  }

  if (allFaculty.length >= 2) {
    const targetA = allFaculty[0];
    const targetB = allFaculty[1];

    const testUrlA = `https://images.unsplash.com/photo-test-faculty-a-${Date.now()}?w=400`;
    console.log(`\nTesting update for Faculty A (${targetA.fullName}, _id: ${targetA._id})`);
    console.log(`Updating avatarUrl to: ${testUrlA}`);

    // PUT /api/admin/faculty/:id
    const putRes = await makeRequest('PUT', `/api/admin/faculty/${targetA._id}`, {
      avatarUrl: testUrlA,
    });

    console.log(`PUT status: ${putRes.status}`);
    console.log(`PUT response avatarUrl: ${putRes.data && putRes.data.data ? putRes.data.data.avatarUrl : 'N/A'}`);

    // GET /api/admin/faculty/:id
    const getSingleRes = await makeRequest('GET', `/api/admin/faculty/${targetA._id}`);
    console.log(`GET single status: ${getSingleRes.status}`);
    console.log(`GET single response avatarUrl: ${getSingleRes.data && getSingleRes.data.data ? getSingleRes.data.data.avatarUrl : 'N/A'}`);

    // GET /api/admin/faculty?page=1&limit=20
    const getListRes = await makeRequest('GET', `/api/admin/faculty?page=1&limit=20`);
    console.log(`GET list status: ${getListRes.status}`);

    if (getListRes.data && getListRes.data.data && Array.isArray(getListRes.data.data)) {
      const docAInList = getListRes.data.data.find((item) => item._id === targetA._id.toString() || item.id === targetA._id.toString());
      const docBInList = getListRes.data.data.find((item) => item._id === targetB._id.toString() || item.id === targetB._id.toString());

      console.log(`List item for Faculty A (${targetA.fullName}): avatarUrl = ${docAInList ? docAInList.avatarUrl : 'NOT FOUND'}`);
      console.log(`List item for Faculty B (${targetB.fullName}): avatarUrl = ${docBInList ? docBInList.avatarUrl : 'NOT FOUND'}`);
    }

    // Verify DB state after test
    const freshA = await Faculty.findById(targetA._id).lean();
    const freshB = await Faculty.findById(targetB._id).lean();

    console.log(`\nMongoDB state after test:`);
    console.log(`Faculty A (${freshA.fullName}) avatarUrl in DB: ${freshA.avatarUrl}`);
    console.log(`Faculty B (${freshB.fullName}) avatarUrl in DB: ${freshB.avatarUrl}`);

    // Restore Faculty A DB state
    await Faculty.findByIdAndUpdate(targetA._id, { avatarUrl: targetA.avatarUrl || '' });
    console.log(`Restored Faculty A avatarUrl back to original.`);
  }

  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

runInvestigation().catch((err) => {
  console.error('Investigation error:', err);
  process.exit(1);
});
