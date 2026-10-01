const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { app } = require('../server');
const User = require('../models/User');

const PORT = 5099;
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
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(PORT);

  const admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  const adminHeaders = { Authorization: `Bearer ${jwt.sign({ id: admin._id, email: admin.email, role: admin.role }, JWT_SECRET)}` };

  const resA = await req('/api/faculty', 'POST', adminHeaders, {
    fullName: 'Dup1', email: 'dup1@test.com', department: 'Dep', role: 'Role', qualification: 'Qual'
  });
  const resB = await req('/api/faculty', 'POST', adminHeaders, {
    fullName: 'Dup2', email: 'dup2@test.com', department: 'Dep', role: 'Role', qualification: 'Qual'
  });

  const idB = resB.body.data._id;
  const resUpdate = await req(`/api/faculty/${idB}`, 'PUT', adminHeaders, { email: 'dup1@test.com' });
  
  console.log(`Update status: ${resUpdate.status}`);
  console.log(`Update body: ${JSON.stringify(resUpdate.body)}`);

  await req(`/api/faculty/${resA.body.data._id}`, 'DELETE', adminHeaders);
  await req(`/api/faculty/${idB}`, 'DELETE', adminHeaders);

  server.close();
  await mongoose.disconnect();
}
run();
