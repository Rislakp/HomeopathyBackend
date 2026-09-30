/**
 * Comprehensive Test Suite: Unani Subscription API
 * Tests all Admin CRUD + Status toggle + Student read + RBAC
 */

const path = require('path');
const http = require('http');
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { app } = require('../server');
const User = require('../models/User');
const UnaniSubscription = require('../src/unani/subscriptions/models/unaniSubscription.model');

const PORT = 5097;
let server;
const JWT_SECRET = process.env.JWT_SECRET || 'white_coat_academy_secret_jwt_key_2026_super_secure';

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function req(urlPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ─── Test runner ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n====================================================');
  console.log('  UNANI SUBSCRIPTION API — FULL TEST SUITE');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);

  server = await new Promise(resolve => {
    const s = app.listen(PORT, () => { console.log(`Server on port ${PORT}\n`); resolve(s); });
  });

  const ts = Date.now();
  let adminToken, createdId;

  // ─── Find or create admin ────────────────────────────────────────────────
  const admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  if (!admin) { console.error('No admin found. Aborting.'); process.exit(1); }

  adminToken = jwt.sign(
    { id: admin._id.toString(), userId: admin._id.toString(), email: admin.email, role: admin.role },
    JWT_SECRET, { expiresIn: '1h' }
  );
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  // ─── T1: Admin POST — Create subscription ────────────────────────────────
  console.log('── T1: Admin POST /api/admin/unani/subscriptions ──');
  {
    const r = await req('/api/admin/unani/subscriptions', 'POST', adminAuth, {
      name: `Test Unani Plan ${ts}`,
      description: 'Comprehensive exam prep for Unani practitioners',
      price: 4999,
      duration: 12,
      durationUnit: 'months',
      frequency: 'Yearly',
      billingSuffix: '/year',
      features: ['Grand Mock Tests', 'Study Materials', 'Doubt Clearing'],
      isMostPopular: false,
      isActive: true,
      displayOrder: 99,
    });
    check('POST returns 201', r.status === 201, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('data._id exists', !!r.body.data?._id, JSON.stringify(r.body));
    check('name matches', r.body.data?.name === `Test Unani Plan ${ts}` || r.body.data?.title === `Test Unani Plan ${ts}`);
    check('price is 4999', Number(r.body.data?.price) === 4999);
    check('isActive is true', r.body.data?.isActive === true || r.body.data?.status === 'Active');
    check('courseId is unani', r.body.data?.courseId === 'unani');
    createdId = r.body.data?._id || r.body.data?.id;
    console.log(`  Created ID: ${createdId}\n`);
  }

  // ─── T2: Admin GET list ───────────────────────────────────────────────────
  console.log('── T2: Admin GET /api/admin/unani/subscriptions ──');
  {
    const r = await req('/api/admin/unani/subscriptions', 'GET', adminAuth);
    check('GET list returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('data is array', Array.isArray(r.body.data));
    check('pagination present', !!r.body.pagination);
    const found = r.body.data?.find(s => s._id === createdId || s.id === createdId);
    check('created plan in list', !!found, `ID: ${createdId}`);
    console.log('');
  }

  // ─── T3: Admin GET single ─────────────────────────────────────────────────
  console.log('── T3: Admin GET /api/admin/unani/subscriptions/:id ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}`, 'GET', adminAuth);
    check('GET single returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('correct ID returned', r.body.data?._id === createdId || r.body.data?.id === createdId);
    console.log('');
  }

  // ─── T4: Admin PUT update ─────────────────────────────────────────────────
  console.log('── T4: Admin PUT /api/admin/unani/subscriptions/:id ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}`, 'PUT', adminAuth, {
      description: 'UPDATED: Best-in-class Unani prep course',
      price: 5499,
      features: ['Grand Mock Tests', 'Study Materials', 'Doubt Clearing', 'Rank Tracking'],
    });
    check('PUT returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('price updated to 5499', Number(r.body.data?.price) === 5499);
    check('features updated (4 items)', r.body.data?.features?.length === 4);
    console.log('');
  }

  // ─── T5: Admin PATCH status → Inactive ───────────────────────────────────
  console.log('── T5: Admin PATCH /api/admin/unani/subscriptions/:id/status (Inactive) ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}/status`, 'PATCH', adminAuth, {
      isActive: false,
    });
    check('PATCH returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('isActive is false', r.body.data?.isActive === false);
    check('status is Inactive', r.body.data?.status === 'Inactive');
    console.log('');
  }

  // ─── T6: Student GET list — inactive plan must NOT appear ────────────────
  console.log('── T6: Student GET /api/unani/subscriptions (inactive hidden) ──');
  {
    const r = await req('/api/unani/subscriptions', 'GET', {});
    check('Student GET returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('data is array', Array.isArray(r.body.data));
    const found = r.body.data?.find(s => s._id === createdId || s.id === createdId);
    check('inactive plan NOT in student list', !found, found ? `Found! ID: ${createdId}` : 'correctly hidden');
    console.log('');
  }

  // ─── T7: Student GET single — inactive → 404 ─────────────────────────────
  console.log('── T7: Student GET /api/unani/subscriptions/:id (inactive → 404) ──');
  {
    const r = await req(`/api/unani/subscriptions/${createdId}`, 'GET', {});
    check('Inactive sub returns 404 for student', r.status === 404, `got ${r.status}`);
    console.log('');
  }

  // ─── T8: Admin PATCH status → Active ─────────────────────────────────────
  console.log('── T8: Admin PATCH /api/admin/unani/subscriptions/:id/status (Active) ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}/status`, 'PATCH', adminAuth, {
      status: 'Active',
    });
    check('PATCH returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    check('isActive is true', r.body.data?.isActive === true);
    check('status is Active', r.body.data?.status === 'Active');
    console.log('');
  }

  // ─── T9: Student GET list — now active plan IS visible ───────────────────
  console.log('── T9: Student GET /api/unani/subscriptions (active visible) ──');
  {
    const r = await req('/api/unani/subscriptions', 'GET', {});
    check('Student GET returns 200', r.status === 200, `got ${r.status}`);
    const found = r.body.data?.find(s => s._id === createdId || s.id === createdId);
    check('active plan IS in student list', !!found, !found ? `ID ${createdId} not found` : 'ok');
    // Verify admin fields are NOT exposed
    if (found) {
      check('isDeleted NOT in student response', found.isDeleted === undefined);
    }
    console.log('');
  }

  // ─── T10: Student GET single — active → 200 ──────────────────────────────
  console.log('── T10: Student GET /api/unani/subscriptions/:id (active → 200) ──');
  {
    const r = await req(`/api/unani/subscriptions/${createdId}`, 'GET', {});
    check('Active sub returns 200 for student', r.status === 200, `got ${r.status}`);
    check('correct data returned', r.body.data?._id === createdId || r.body.data?.id === createdId);
    console.log('');
  }

  // ─── T11: RBAC — Unauthenticated → 401 ───────────────────────────────────
  console.log('── T11: RBAC — No token → 401 on admin endpoints ──');
  {
    const r1 = await req('/api/admin/unani/subscriptions', 'GET', {});
    check('GET list without token → 401', r1.status === 401, `got ${r1.status}`);
    const r2 = await req('/api/admin/unani/subscriptions', 'POST', {}, { name: 'X', price: 100, duration: 1 });
    check('POST without token → 401', r2.status === 401, `got ${r2.status}`);
    console.log('');
  }

  // ─── T12: RBAC — Student token on admin route → 403 ─────────────────────
  console.log('── T12: RBAC — Student token → 403 on admin endpoints ──');
  {
    const Student = require('../models/Student');
    const studentDoc = await Student.findOne({});
    if (studentDoc) {
      const studentToken = jwt.sign(
        { id: studentDoc._id.toString(), studentId: studentDoc._id.toString(), email: studentDoc.email, role: 'student' },
        JWT_SECRET, { expiresIn: '1h' }
      );
      const r = await req('/api/admin/unani/subscriptions', 'GET', { Authorization: `Bearer ${studentToken}` });
      check('Student token on admin route → 403', r.status === 403, `got ${r.status}`);
    } else {
      check('Student RBAC test skipped (no student in DB)', true);
    }
    console.log('');
  }

  // ─── T13: Admin DELETE ─────────────────────────────────────────────────────
  console.log('── T13: Admin DELETE /api/admin/unani/subscriptions/:id ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}`, 'DELETE', adminAuth);
    check('DELETE returns 200', r.status === 200, `got ${r.status}`);
    check('success: true', r.body.success === true);
    console.log('');
  }

  // ─── T14: GET after delete → 404 ─────────────────────────────────────────
  console.log('── T14: GET after DELETE → 404 ──');
  {
    const r = await req(`/api/admin/unani/subscriptions/${createdId}`, 'GET', adminAuth);
    check('GET deleted sub returns 404', r.status === 404, `got ${r.status}`);
    console.log('');
  }

  // ─── T15: Validation — missing required fields ────────────────────────────
  console.log('── T15: Validation — missing required fields ──');
  {
    const r = await req('/api/admin/unani/subscriptions', 'POST', adminAuth, {
      description: 'No name, no price, no duration',
    });
    check('Missing required fields → 400', r.status === 400, `got ${r.status}`);
    check('errors array present', Array.isArray(r.body.errors));
    console.log('');
  }

  // ─── T16: Student URL aliases ─────────────────────────────────────────────
  console.log('── T16: Student route aliases ──');
  {
    const r1 = await req('/api/student/unani/subscriptions', 'GET', {});
    check('/api/student/unani/subscriptions returns 200', r1.status === 200, `got ${r1.status}`);
    const r2 = await req('/api/v1/unani/subscriptions', 'GET', {});
    check('/api/v1/unani/subscriptions returns 200', r2.status === 200, `got ${r2.status}`);
    console.log('');
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  // Safety: ensure our test doc is cleaned up even if delete test failed
  try {
    await UnaniSubscription.deleteMany({ name: { $regex: `Test Unani Plan ${ts}` } });
  } catch {}

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('====================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  server.close();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test suite crashed:', err);
  if (server) server.close();
  mongoose.disconnect();
  process.exit(1);
});
