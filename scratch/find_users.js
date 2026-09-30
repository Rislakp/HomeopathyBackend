const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await User.findOne({ role: { $in: ['admin', 'superadmin'] } });
  console.log('Found admin:', admin ? { id: admin._id, email: admin.email, role: admin.role } : null);
  const student = await User.findOne({ role: 'student' });
  console.log('Found student:', student ? { id: student._id, email: student.email, role: student.role } : null);
  process.exit(0);
}
check().catch(console.error);
